CREATE TABLE IF NOT EXISTS "mcp_oauth_grant" (
	"publicId" varchar(12) PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"clientId" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" text[] NOT NULL,
	"redirectUri" text NOT NULL,
	"codeChallenge" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_token" (
	"hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"grantPublicId" varchar(12) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_grant" ADD CONSTRAINT "mcp_oauth_grant_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_token" ADD CONSTRAINT "mcp_oauth_token_grantPublicId_mcp_oauth_grant_publicId_fk" FOREIGN KEY ("grantPublicId") REFERENCES "public"."mcp_oauth_grant"("publicId") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_grant_user_idx" ON "mcp_oauth_grant" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_token_grant_idx" ON "mcp_oauth_token" USING btree ("grantPublicId");