import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { createOpenApiNextHandler } from "trpc-to-openapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { account, boards, cards, lists } from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { cardRouter } from "../src/routers/card";
import { listRouter } from "../src/routers/list";
import { workspaceRouter } from "../src/routers/workspace";
import { createTRPCRouter } from "../src/trpc";
import { createTestDb, seedTestData } from "./test-db";

const state = vi.hoisted(() => ({ db: undefined as TestDbClient | undefined }));
vi.mock("@kan/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kan/db/client")>()),
  createDrizzleClient: () => state.db,
}));

describe("MCP OAuth HTTP protocol with a real Kan login", () => {
  const clientId = "https://chatgpt.com/oauth/test-http/client.json";
  const redirectUri = "https://chatgpt.com/connector/oauth/test-http";
  const verifier = "a".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const nativeFetch = globalThis.fetch;
  let base: string;
  let cookie: string;
  let handler: typeof import("../../../apps/web/src/pages/api/mcp/oauth/[action]").default;
  let restHandler: ReturnType<typeof createOpenApiNextHandler>;
  const server = createServer((req, res) => {
    Object.assign(req, {
      query: Object.fromEntries(
        new URL(req.url ?? "/", "http://localhost").searchParams,
      ),
    });
    if (req.url?.startsWith("/api/v1/")) {
      Object.assign(req, {
        query: { trpc: req.url.slice("/api/v1/".length).split("/") },
      });
      void restHandler(req as never, res as never);
    } else {
      if (req.url?.startsWith("/.well-known/"))
        Object.assign(req, {
          query: {
            action: req.url.includes("oauth-protected-resource")
              ? "resource"
              : "metadata",
          },
        });
      void handler(req as never, res as never);
    }
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", base);
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "test-only-strong-secret-that-is-not-used-in-production",
    );
    vi.stubEnv("NEXT_PUBLIC_ALLOW_CREDENTIALS", "true");
    state.db = await createTestDb();
    const { user, workspace } = await seedTestData(state.db);
    await state.db.insert(boards).values({
      publicId: "httpboard123",
      name: "HTTP fixture",
      slug: "http-fixture",
      workspaceId: workspace.id,
      visibility: "private",
      createdBy: user.id,
    });
    await state.db.insert(account).values({
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword("local-test-password-123!"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === clientId)
          return Response.json({
            client_id: clientId,
            client_name: "ChatGPT",
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "private_key_jwt",
            token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
          });
        return nativeFetch(input, init);
      }),
    );
    handler = (
      await import("../../../apps/web/src/pages/api/mcp/oauth/[action]")
    ).default;
    const { createRESTContext } = await import("../src/trpc-context");
    restHandler = createOpenApiNextHandler({
      router: createTRPCRouter({
        card: cardRouter,
        list: listRouter,
        workspace: workspaceRouter,
      }),
      createContext: createRESTContext,
    });
    const { mcpAuth } = await import(
      "../../../apps/web/src/server/mcp-oauth-provider"
    );
    const login = await mcpAuth.api.signInEmail({
      body: { email: user.email, password: "local-test-password-123!" },
      asResponse: true,
    });
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
  }, 45_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function authorizationUrl(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${base}/api/mcp`,
      scope: "kan:mcp",
      state: "preserved-state",
      ...overrides,
    });
    return `${base}/api/mcp/oauth/authorize?${params}`;
  }
  async function form(
    action: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ) {
    return nativeFetch(`${base}/api/mcp/oauth/${action}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body),
    });
  }

  it("publishes PKCE and CIMD discovery without advertising unsupported methods", async () => {
    const response = await nativeFetch(
      `${base}/.well-known/oauth-authorization-server`,
    );
    expect(await response.json()).toMatchObject({
      issuer: base,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    const resource = await nativeFetch(
      `${base}/.well-known/oauth-protected-resource/api/mcp`,
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
    });
  });

  it("requires a Kan login and exact registered callback", async () => {
    const login = await nativeFetch(authorizationUrl(), { redirect: "manual" });
    expect(login.status).toBe(302);
    expect(new URL(login.headers.get("location")!).pathname).toBe("/login");
    const bad = await nativeFetch(
      authorizationUrl({ redirect_uri: "https://evil.test/callback" }),
      { redirect: "manual" },
    );
    expect(bad.status).toBe(400);
    const wrongClient = await nativeFetch(
      authorizationUrl({ client_id: "https://evil.test/client.json" }),
      { redirect: "manual" },
    );
    expect(wrongClient.status).toBe(400);
    const wrongScope = await nativeFetch(authorizationUrl({ scope: "admin" }), {
      redirect: "manual",
      headers: { cookie },
    });
    const failure = new URL(wrongScope.headers.get("location")!);
    expect(failure.searchParams.get("iss")).toBe(base);
    expect(failure.searchParams.get("error")).toBe("invalid_scope");
  });

  it("requires consent, validates CSRF origin and S256, then rotates and revokes real tokens", async () => {
    const authorization = await nativeFetch(authorizationUrl(), {
      redirect: "manual",
      headers: { cookie },
    });
    expect(authorization.status).toBe(302);
    const request = new URL(
      authorization.headers.get("location")!,
    ).searchParams.get("request")!;
    expect(request).toBeTruthy();
    const csrf = await form(
      "consent",
      { request, decision: "approve" },
      { cookie, origin: "https://evil.test" },
    );
    expect(csrf.status).toBe(403);
    const consent = await form(
      "consent",
      { request, decision: "approve" },
      { cookie, origin: base },
    );
    expect(consent.status).toBe(303);
    const callback = new URL(consent.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("preserved-state");
    const tokenBody = {
      client_id: clientId,
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirectUri,
      resource: `${base}/api/mcp`,
      code_verifier: verifier,
    };
    const wrongPkce = await form("token", {
      ...tokenBody,
      code_verifier: "b".repeat(43),
    });
    expect(wrongPkce.status).toBe(400);
    const tokenResponse = await form("token", tokenBody);
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.access_token).toMatch(/^kan_mcp_access_/);
    const refresh = await form("token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: `${base}/api/mcp`,
    });
    expect(refresh.status).toBe(200);
    const rotated = (await refresh.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    const revoke = await form("revoke", {
      client_id: clientId,
      token: rotated.refresh_token,
    });
    expect(revoke.status).toBe(200);
    const revoked = await form("token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: rotated.refresh_token,
    });
    expect(revoked.status).toBe(400);
  });

  it("rejects consent denial without issuing an authorization code", async () => {
    const authorization = await nativeFetch(authorizationUrl(), {
      redirect: "manual",
      headers: { cookie },
    });
    const request = new URL(
      authorization.headers.get("location")!,
    ).searchParams.get("request")!;
    const denial = await form(
      "consent",
      { request, decision: "deny" },
      { cookie, origin: base },
    );
    expect(denial.status).toBe(303);
    const callback = new URL(denial.headers.get("location")!);
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.has("code")).toBe(false);
    expect(
      (
        await form(
          "consent",
          { request, decision: "approve" },
          { cookie, origin: base },
        )
      ).status,
    ).toBe(400);
  });

  it("creates, updates and soft-deletes cards and lists through the original REST API", async () => {
    const authorization = await nativeFetch(authorizationUrl(), {
      redirect: "manual",
      headers: { cookie },
    });
    const request = new URL(
      authorization.headers.get("location")!,
    ).searchParams.get("request")!;
    const consent = await form(
      "consent",
      { request, decision: "approve" },
      { cookie, origin: base },
    );
    const code = new URL(consent.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const tokenResponse = await form("token", {
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      resource: `${base}/api/mcp`,
      code_verifier: verifier,
    });
    const { access_token: token } = (await tokenResponse.json()) as {
      access_token: string;
    };
    async function api(
      method: string,
      path: string,
      body?: Record<string, unknown>,
    ) {
      const response = await nativeFetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = (await response.json()) as {
        publicId: string;
        success?: boolean;
      };
      expect(
        response.status,
        `${method} ${path}: ${JSON.stringify(result)}`,
      ).toBe(200);
      return result;
    }
    const list = await api("POST", "/lists", {
      boardPublicId: "httpboard123",
      name: "OAuth fixture",
    });
    expect(list.publicId).toHaveLength(12);
    await api("PUT", `/lists/${list.publicId}`, { name: "Renamed fixture" });
    const card = await api("POST", "/cards", {
      listPublicId: list.publicId,
      title: "OAuth fixture",
      description: "",
      labelPublicIds: [],
      memberPublicIds: [],
      position: "end",
    });
    expect(card.publicId).toHaveLength(12);
    await api("PUT", `/cards/${card.publicId}`, { title: "Updated fixture" });
    expect((await api("DELETE", `/cards/${card.publicId}`)).success).toBe(true);
    expect((await api("DELETE", `/lists/${list.publicId}`)).success).toBe(true);
    const [deletedCard] = await state
      .db!.select()
      .from(cards)
      .where(eq(cards.publicId, card.publicId));
    const [deletedList] = await state
      .db!.select()
      .from(lists)
      .where(eq(lists.publicId, list.publicId));
    expect(deletedCard?.deletedAt).toBeInstanceOf(Date);
    expect(deletedList?.deletedAt).toBeInstanceOf(Date);
    const forbidden = await nativeFetch(
      `${base}/api/v1/workspaces/wstest123456`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
    );
    expect(forbidden.status).toBe(403);
  });
});
