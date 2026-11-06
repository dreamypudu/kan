import { createHash, randomBytes } from "node:crypto";
import { env } from "next-runtime-env";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as oauthRepo from "@kan/db/repository/mcp-oauth.repo";
import { generateUID } from "@kan/shared/utils";

export const MCP_SCOPE = "kan:mcp";
export function isMcpOAuthOperationAllowed(method: string, path: string) {
  const id = "[a-zA-Z0-9]{12}";
  const routes: Record<string, string[]> = {
    GET: [
      "/workspaces",
      `/workspaces/${id}`,
      `/workspaces/${id}/boards`,
      `/workspaces/${id}/search`,
      `/boards/${id}`,
      `/cards/${id}`,
      `/cards/${id}/activities`,
      `/labels/${id}`,
    ],
    POST: [
      `/workspaces/${id}/boards`,
      "/lists",
      "/cards",
      `/cards/${id}/comments`,
      `/cards/${id}/checklists`,
      `/checklists/${id}/items`,
      "/labels",
    ],
    PUT: [
      `/lists/${id}`,
      `/cards/${id}`,
      `/cards/${id}/(?:labels|members)/${id}`,
      `/checklists/${id}`,
      `/checklists/items/${id}`,
    ],
    DELETE: [`/cards/${id}`, `/lists/${id}`],
  };
  return (
    routes[method]?.some((route) => new RegExp(`^${route}$`).test(path)) ??
    false
  );
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const secret = (kind: string) =>
  `kan_mcp_${kind}_${randomBytes(32).toString("base64url")}`;
const lifetime = 60 * 60;

export function getMcpOAuthUrls() {
  const base = env("NEXT_PUBLIC_BASE_URL")?.replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_BASE_URL is required for MCP OAuth");
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    throw new Error("MCP OAuth requires HTTPS");
  }
  return { base, resource: `${base}/api/mcp`, issuer: base };
}

const requestSchema = z.object({
  userId: z.string().uuid(),
  clientId: z.string().url(),
  redirectUri: z.string().url(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  resource: z.string().url(),
  scopes: z.array(z.literal(MCP_SCOPE)),
  state: z.string().optional(),
});
export type McpAuthorizationRequest = z.infer<typeof requestSchema>;

export async function createMcpAuthorization(
  db: dbClient,
  input: McpAuthorizationRequest,
) {
  const data = requestSchema.parse(input);
  if (
    data.resource !== getMcpOAuthUrls().resource ||
    !data.scopes.includes(MCP_SCOPE)
  ) {
    throw new Error("Invalid MCP resource or scope");
  }
  const request = secret("request");
  await oauthRepo.saveRequest(db, hashToken(request), JSON.stringify(data));
  return request;
}

export async function getMcpAuthorization(
  db: dbClient,
  request: string,
  userId: string,
) {
  const record = await oauthRepo.getRequest(db, hashToken(request));
  if (!record) return null;
  const parsed = requestSchema.safeParse(JSON.parse(record.value));
  return parsed.success && parsed.data.userId === userId ? parsed.data : null;
}

export async function approveMcpAuthorization(
  db: dbClient,
  request: string,
  userId: string,
) {
  const data = await getMcpAuthorization(db, request, userId);
  if (!data) return null;
  const publicId = generateUID();
  const code = secret("code");
  const approved = await oauthRepo.approveRequest(
    db,
    hashToken(request),
    {
      publicId,
      ...data,
    },
    {
      hash: hashToken(code),
      kind: "code",
      grantPublicId: publicId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  );
  return approved ? { code, data } : null;
}

export async function findMcpToken(db: dbClient, token: string) {
  if (!token.startsWith("kan_mcp_")) return null;
  return (await oauthRepo.getToken(db, hashToken(token))) ?? null;
}

export async function verifyMcpAccessToken(db: dbClient, token: string) {
  const record = await findMcpToken(db, token);
  if (
    !record ||
    record.token.kind !== "access" ||
    record.token.consumedAt ||
    record.token.expiresAt <= new Date() ||
    record.grant.resource !== getMcpOAuthUrls().resource ||
    !record.grant.scopes.includes(MCP_SCOPE)
  )
    return null;
  return record;
}

export async function exchangeMcpToken(
  db: dbClient,
  token: string,
  clientId: string,
  kind: "code" | "refresh",
  resource?: URL,
  redirectUri?: string,
  scopes?: string[],
) {
  const record = await findMcpToken(db, token);
  if (
    !record ||
    record.token.kind !== kind ||
    record.grant.clientId !== clientId ||
    record.token.expiresAt <= new Date() ||
    (resource && resource.href !== record.grant.resource) ||
    record.grant.resource !== getMcpOAuthUrls().resource ||
    (kind === "code" && redirectUri !== record.grant.redirectUri) ||
    scopes?.some((scope) => !record.grant.scopes.includes(scope))
  )
    return null;
  const accessToken = secret("access");
  const refreshToken = secret("refresh");
  const grantPublicId = record.grant.publicId;
  const refreshExpiry =
    kind === "refresh"
      ? record.token.expiresAt
      : new Date(Date.now() + 30 * 86400_000);
  const exchanged = await oauthRepo.exchangeToken(db, hashToken(token), [
    {
      hash: hashToken(accessToken),
      kind: "access",
      grantPublicId,
      expiresAt: new Date(Date.now() + lifetime * 1000),
    },
    {
      hash: hashToken(refreshToken),
      kind: "refresh",
      grantPublicId,
      expiresAt: refreshExpiry,
    },
  ]);
  return exchanged
    ? {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer" as const,
        expires_in: lifetime,
        scope: record.grant.scopes.join(" "),
      }
    : null;
}
