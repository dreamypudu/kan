import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { z } from "zod";

import {
  createMcpAuthorization,
  exchangeMcpToken,
  findMcpToken,
  getMcpOAuthUrls,
  MCP_SCOPE,
  verifyMcpAccessToken,
} from "@kan/auth/mcp-oauth";
import { initAuth } from "@kan/auth/server";
import { createDrizzleClient } from "@kan/db/client";
import * as oauthRepo from "@kan/db/repository/mcp-oauth.repo";

export const mcpDb = createDrizzleClient();
export const mcpAuth = initAuth(mcpDb);

const clients = new Map<
  string,
  { client: OAuthClientInformationFull; expires: number }
>();
const metadataSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().max(100).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
});

// Fetch only OpenAI's published CIMD paths, never an arbitrary client-supplied URL.
export async function getChatGptClient(
  clientId: string,
): Promise<OAuthClientInformationFull | undefined> {
  if (
    !/^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(
      clientId,
    )
  )
    return undefined;
  const cached = clients.get(clientId);
  if (cached && cached.expires > Date.now()) return cached.client;
  const response = await fetch(clientId, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return undefined;
  const text = await response.text();
  if (text.length > 16_384) return undefined;
  const result = metadataSchema.safeParse(JSON.parse(text));
  if (!result.success || result.data.client_id !== clientId) return undefined;
  const metadata = result.data;
  const methods = metadata.token_endpoint_auth_methods_supported ?? [
    metadata.token_endpoint_auth_method,
  ];
  if (
    !methods.includes("none") ||
    metadata.redirect_uris.some((uri) => {
      const url = new URL(uri);
      return (
        url.origin !== "https://chatgpt.com" ||
        url.hash ||
        url.search ||
        !/^\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(
          url.pathname,
        )
      );
    })
  )
    return undefined;
  const client: OAuthClientInformationFull = {
    client_id: clientId,
    client_name: metadata.client_name ?? "ChatGPT",
    redirect_uris: metadata.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: MCP_SCOPE,
  };
  if (clients.size >= 32) clients.clear();
  clients.set(clientId, { client, expires: Date.now() + 5 * 60_000 });
  return client;
}

export function browserHeaders(cookie: string | undefined) {
  return new Headers(cookie ? { cookie } : {});
}

export const mcpOAuthProvider: OAuthServerProvider = {
  clientsStore: { getClient: getChatGptClient },
  async authorize(client, params, res) {
    const { base, resource } = getMcpOAuthUrls();
    if (params.resource?.href !== resource)
      throw new InvalidTargetError("Incorrect MCP resource");
    const scopes = params.scopes?.length ? params.scopes : [MCP_SCOPE];
    if (scopes.some((scope) => scope !== MCP_SCOPE))
      throw new InvalidScopeError("Unsupported scope");
    const session = await mcpAuth.api.getSession({
      headers: browserHeaders(res.req.headers.cookie),
    });
    if (!session) {
      const next = new URL(res.req.originalUrl, base);
      res.redirect(
        `${base}/login?next=${encodeURIComponent(next.pathname + next.search)}`,
      );
      return;
    }
    const request = await createMcpAuthorization(mcpDb, {
      userId: session.user.id,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      resource,
      scopes: [MCP_SCOPE],
      state: params.state,
    });
    res.redirect(`${base}/mcp?request=${encodeURIComponent(request)}`);
  },
  async challengeForAuthorizationCode(client, code) {
    const record = await findMcpToken(mcpDb, code);
    if (
      !record ||
      record.token.kind !== "code" ||
      record.grant.clientId !== client.client_id ||
      record.token.expiresAt <= new Date()
    )
      throw new InvalidGrantError("Invalid authorization code");
    return record.grant.codeChallenge;
  },
  async exchangeAuthorizationCode(
    client,
    code,
    _verifier,
    redirectUri,
    resource,
  ) {
    const tokens = await exchangeMcpToken(
      mcpDb,
      code,
      client.client_id,
      "code",
      resource,
      redirectUri,
    );
    if (!tokens) throw new InvalidGrantError("Invalid authorization code");
    return tokens;
  },
  async exchangeRefreshToken(client, token, scopes, resource) {
    const tokens = await exchangeMcpToken(
      mcpDb,
      token,
      client.client_id,
      "refresh",
      resource,
      undefined,
      scopes,
    );
    if (!tokens) throw new InvalidGrantError("Invalid refresh token");
    return tokens;
  },
  async verifyAccessToken(token) {
    const record = await verifyMcpAccessToken(mcpDb, token);
    if (!record) throw new InvalidTokenError("Invalid access token");
    return {
      token,
      clientId: record.grant.clientId,
      scopes: record.grant.scopes,
      expiresAt: Math.floor(record.token.expiresAt.getTime() / 1000),
      resource: new URL(record.grant.resource),
    };
  },
  async revokeToken(client, request) {
    const record = await findMcpToken(mcpDb, request.token);
    if (!record) return;
    if (record.grant.clientId !== client.client_id)
      throw new InvalidClientError("Incorrect client");
    await oauthRepo.revokeGrant(mcpDb, record.grant.publicId, record.user.id);
  },
};
