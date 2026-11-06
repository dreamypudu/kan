import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  approveMcpAuthorization,
  createMcpAuthorization,
  exchangeMcpToken,
  getMcpAuthorization,
  hashToken,
  isMcpOAuthOperationAllowed,
  MCP_SCOPE,
  verifyMcpAccessToken,
} from "@kan/auth/mcp-oauth";
import * as oauthRepo from "@kan/db/repository/mcp-oauth.repo";
import { boards, mcpOAuthTokens, users, verification } from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { boardRouter } from "../src/routers/board";
import { createTestDb, seedTestData } from "./test-db";

describe("MCP OAuth persistent authorization", () => {
  let db: TestDbClient;
  let userId: string;
  const resource = new URL("https://kan.test/api/mcp");
  const clientId = "https://chatgpt.com/oauth/example/client.json";
  const redirectUri = "https://chatgpt.com/connector/oauth/example";
  const verifier = "v".repeat(43);
  const codeChallenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://kan.test");
    db = await createTestDb();
    const seed = await seedTestData(db);
    userId = seed.user.id;
    await db.insert(boards).values({
      publicId: "oauthboard12",
      name: "Private board",
      slug: "private-oauth",
      workspaceId: seed.workspace.id,
      createdBy: userId,
      visibility: "private",
    });
  }, 30_000);

  async function authorize() {
    const request = await createMcpAuthorization(db, {
      userId,
      clientId,
      redirectUri,
      codeChallenge,
      resource: resource.href,
      scopes: [MCP_SCOPE],
      state: "test-state",
    });
    const result = await approveMcpAuthorization(db, request, userId);
    expect(result).not.toBeNull();
    return { request, code: result!.code };
  }

  it("binds consent to its user, expires requests, and accepts each approval once", async () => {
    const { request } = await authorize();
    expect(await getMcpAuthorization(db, request, userId)).toBeNull();
    expect(await approveMcpAuthorization(db, request, userId)).toBeNull();
    const pending = await createMcpAuthorization(db, {
      userId,
      clientId,
      redirectUri,
      codeChallenge,
      resource: resource.href,
      scopes: [MCP_SCOPE],
    });
    expect(await getMcpAuthorization(db, pending, randomUUID())).toBeNull();
    expect(await getMcpAuthorization(db, pending, userId)).not.toBeNull();
    await db
      .update(verification)
      .set({ expiresAt: new Date(0) })
      .where(eq(verification.identifier, `mcp:${hashToken(pending)}`));
    expect(await getMcpAuthorization(db, pending, userId)).toBeNull();
  });

  it("stores hashes, checks client, callback and audience, and authenticates the original user", async () => {
    const { code } = await authorize();
    expect(
      await exchangeMcpToken(db, code, "wrong", "code", resource, redirectUri),
    ).toBeNull();
    expect(
      await exchangeMcpToken(
        db,
        code,
        clientId,
        "code",
        new URL("https://other.test"),
        redirectUri,
      ),
    ).toBeNull();
    expect(
      await exchangeMcpToken(
        db,
        code,
        clientId,
        "code",
        resource,
        "https://evil.test",
      ),
    ).toBeNull();
    const tokens = await exchangeMcpToken(
      db,
      code,
      clientId,
      "code",
      resource,
      redirectUri,
    );
    expect(tokens?.refresh_token).toBeTruthy();
    const record = await verifyMcpAccessToken(db, tokens!.access_token);
    expect(record?.user.id).toBe(userId);
    expect(record?.token.hash).toBe(hashToken(tokens!.access_token));
    expect(JSON.stringify(record)).not.toContain(tokens!.access_token);
    const caller = boardRouter.createCaller({
      db,
      user: record!.user,
      headers: new Headers(),
    } as never);
    expect(
      (await caller.byId({ boardPublicId: "oauthboard12" })).publicId,
    ).toBe("oauthboard12");
    const stranger = {
      ...record!.user,
      id: randomUUID(),
      email: "stranger@example.com",
    };
    await db.insert(users).values(stranger);
    const outsider = boardRouter.createCaller({
      db,
      user: stranger,
      headers: new Headers(),
    } as never);
    await expect(
      outsider.byId({ boardPublicId: "oauthboard12" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rotates refresh tokens, detects reuse and revokes the entire token family", async () => {
    const { code } = await authorize();
    const first = (await exchangeMcpToken(
      db,
      code,
      clientId,
      "code",
      resource,
      redirectUri,
    ))!;
    const second = (await exchangeMcpToken(
      db,
      first.refresh_token,
      clientId,
      "refresh",
      resource,
    ))!;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await verifyMcpAccessToken(db, second.access_token)).not.toBeNull();
    expect(
      await exchangeMcpToken(
        db,
        first.refresh_token,
        clientId,
        "refresh",
        resource,
      ),
    ).toBeNull();
    expect(await verifyMcpAccessToken(db, second.access_token)).toBeNull();
    expect(await verifyMcpAccessToken(db, first.access_token)).toBeNull();
  });

  it("rejects expired access, wrong token types, and revoked grants", async () => {
    const { code } = await authorize();
    const tokens = (await exchangeMcpToken(
      db,
      code,
      clientId,
      "code",
      resource,
      redirectUri,
    ))!;
    const record = (await verifyMcpAccessToken(db, tokens.access_token))!;
    await oauthRepo.revokeGrant(db, record.grant.publicId, randomUUID());
    expect(await verifyMcpAccessToken(db, tokens.access_token)).not.toBeNull();
    expect(await verifyMcpAccessToken(db, tokens.refresh_token)).toBeNull();
    await db
      .update(mcpOAuthTokens)
      .set({ expiresAt: new Date(0) })
      .where(
        and(
          eq(mcpOAuthTokens.hash, hashToken(tokens.access_token)),
          eq(mcpOAuthTokens.kind, "access"),
        ),
      );
    expect(await verifyMcpAccessToken(db, tokens.access_token)).toBeNull();
    await oauthRepo.revokeGrant(db, record.grant.publicId, userId);
    expect(
      await exchangeMcpToken(
        db,
        tokens.refresh_token,
        clientId,
        "refresh",
        resource,
      ),
    ).toBeNull();
  });

  it("permits card/list management but rejects workspace deletion and privilege escalation", () => {
    expect(isMcpOAuthOperationAllowed("DELETE", "/cards/123456789012")).toBe(
      true,
    );
    expect(isMcpOAuthOperationAllowed("DELETE", "/lists/123456789012")).toBe(
      true,
    );
    expect(isMcpOAuthOperationAllowed("PUT", "/lists/123456789012")).toBe(true);
    expect(
      isMcpOAuthOperationAllowed("DELETE", "/workspaces/123456789012"),
    ).toBe(false);
    expect(
      isMcpOAuthOperationAllowed(
        "POST",
        "/workspaces/123456789012/members/invite",
      ),
    ).toBe(false);
    expect(isMcpOAuthOperationAllowed("PUT", "/workspaces/123456789012")).toBe(
      false,
    );
    expect(isMcpOAuthOperationAllowed("PUT", "/boards/123456789012")).toBe(
      false,
    );
    expect(isMcpOAuthOperationAllowed("PUT", "/cards/123456789012")).toBe(true);
    expect(
      isMcpOAuthOperationAllowed("GET", "/cards/123456789012/activities"),
    ).toBe(true);
  });
});
