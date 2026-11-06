import { and, eq, gt, isNull } from "drizzle-orm";

import type { dbClient } from "../client";
import { mcpOAuthGrants, mcpOAuthTokens, users, verification } from "../schema";

type Grant = typeof mcpOAuthGrants.$inferInsert;
type Token = typeof mcpOAuthTokens.$inferInsert;

export async function saveRequest(db: dbClient, hash: string, value: string) {
  await db.insert(verification).values({
    identifier: `mcp:${hash}`,
    value,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(),
  });
}

export async function getRequest(db: dbClient, hash: string) {
  const [request] = await db
    .select()
    .from(verification)
    .where(
      and(
        eq(verification.identifier, `mcp:${hash}`),
        gt(verification.expiresAt, new Date()),
      ),
    );
  return request;
}

export async function deleteRequest(db: dbClient, hash: string) {
  await db
    .delete(verification)
    .where(eq(verification.identifier, `mcp:${hash}`));
}

export async function approveRequest(
  db: dbClient,
  hash: string,
  grant: Grant,
  code: Token,
) {
  return db.transaction(async (tx) => {
    const requests = await tx
      .delete(verification)
      .where(
        and(
          eq(verification.identifier, `mcp:${hash}`),
          gt(verification.expiresAt, new Date()),
        ),
      )
      .returning();
    if (requests.length !== 1) return false;
    await tx.insert(mcpOAuthGrants).values(grant);
    await tx.insert(mcpOAuthTokens).values(code);
    return true;
  });
}

export async function getToken(db: dbClient, hash: string) {
  const [result] = await db
    .select({ token: mcpOAuthTokens, grant: mcpOAuthGrants, user: users })
    .from(mcpOAuthTokens)
    .innerJoin(
      mcpOAuthGrants,
      eq(mcpOAuthTokens.grantPublicId, mcpOAuthGrants.publicId),
    )
    .innerJoin(users, eq(mcpOAuthGrants.userId, users.id))
    .where(
      and(eq(mcpOAuthTokens.hash, hash), isNull(mcpOAuthGrants.revokedAt)),
    );
  return result;
}

// The conditional update makes concurrent code exchanges and refreshes single-use.
export async function exchangeToken(
  db: dbClient,
  hash: string,
  tokens: Token[],
) {
  return db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(mcpOAuthTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(mcpOAuthTokens.hash, hash),
          isNull(mcpOAuthTokens.consumedAt),
          gt(mcpOAuthTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!consumed) {
      // A replay revokes the whole authorization, including its latest access token.
      const [replayed] = await tx
        .select()
        .from(mcpOAuthTokens)
        .where(eq(mcpOAuthTokens.hash, hash));
      if (replayed)
        await tx
          .update(mcpOAuthGrants)
          .set({ revokedAt: new Date() })
          .where(eq(mcpOAuthGrants.publicId, replayed.grantPublicId));
      return false;
    }
    await tx.insert(mcpOAuthTokens).values(tokens);
    return true;
  });
}

export async function revokeGrant(
  db: dbClient,
  publicId: string,
  userId: string,
) {
  await db
    .update(mcpOAuthGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpOAuthGrants.publicId, publicId),
        eq(mcpOAuthGrants.userId, userId),
      ),
    );
}

export async function listGrants(db: dbClient, userId: string) {
  return db
    .select({
      publicId: mcpOAuthGrants.publicId,
      clientId: mcpOAuthGrants.clientId,
      createdAt: mcpOAuthGrants.createdAt,
    })
    .from(mcpOAuthGrants)
    .where(
      and(eq(mcpOAuthGrants.userId, userId), isNull(mcpOAuthGrants.revokedAt)),
    );
}
