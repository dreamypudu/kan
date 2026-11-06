import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const mcpOAuthGrants = pgTable(
  "mcp_oauth_grant",
  {
    publicId: varchar("publicId", { length: 12 }).primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("clientId").notNull(),
    resource: text("resource").notNull(),
    scopes: text("scopes").array().notNull(),
    redirectUri: text("redirectUri").notNull(),
    codeChallenge: text("codeChallenge").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    revokedAt: timestamp("revokedAt"),
  },
  (table) => [index("mcp_oauth_grant_user_idx").on(table.userId)],
).enableRLS();

export const mcpOAuthTokens = pgTable(
  "mcp_oauth_token",
  {
    hash: text("hash").primaryKey(),
    kind: text("kind", { enum: ["code", "access", "refresh"] }).notNull(),
    grantPublicId: varchar("grantPublicId", { length: 12 })
      .notNull()
      .references(() => mcpOAuthGrants.publicId, { onDelete: "cascade" }),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
  },
  (table) => [index("mcp_oauth_token_grant_idx").on(table.grantPublicId)],
).enableRLS();
