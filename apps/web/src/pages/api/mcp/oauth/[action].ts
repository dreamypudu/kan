import type { NextApiRequest, NextApiResponse } from "next";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import express from "express";
import { z } from "zod";

import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  approveMcpAuthorization,
  getMcpAuthorization,
  getMcpOAuthUrls,
  hashToken,
  MCP_SCOPE,
} from "@kan/auth/mcp-oauth";
import * as oauthRepo from "@kan/db/repository/mcp-oauth.repo";

import {
  browserHeaders,
  mcpAuth,
  mcpDb,
  mcpOAuthProvider,
} from "~/server/mcp-oauth-provider";

export const config = { api: { bodyParser: false } };
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
const prefix = "/api/mcp/oauth";
app.get(`${prefix}/metadata`, (_req, res) => {
  const { issuer, base } = getMcpOAuthUrls();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    issuer,
    authorization_endpoint: `${base}${prefix}/authorize`,
    token_endpoint: `${base}${prefix}/token`,
    revocation_endpoint: `${base}${prefix}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: [MCP_SCOPE],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
});
app.get(`${prefix}/resource`, (_req, res) => {
  const { issuer, resource } = getMcpOAuthUrls();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    resource,
    authorization_servers: [issuer],
    scopes_supported: [MCP_SCOPE],
    resource_name: "Kan",
  });
});
app.use(
  `${prefix}/authorize`,
  (_req, res, next) => {
    // SDK errors also need RFC 9207 issuer identification, not just successful consent.
    const redirect = res.redirect.bind(res);
    res.redirect = (statusOrUrl: number | string, url?: string) => {
      let location = typeof statusOrUrl === "string" ? statusOrUrl : url;
      if (!location) throw new Error("Missing OAuth redirect URL");
      const target = new URL(location, getMcpOAuthUrls().base);
      if (target.origin === "https://chatgpt.com") {
        target.searchParams.set("iss", getMcpOAuthUrls().issuer);
        location = target.href;
      }
      return redirect(
        typeof statusOrUrl === "number" ? statusOrUrl : 302,
        location,
      );
    };
    next();
  },
  authorizationHandler({ provider: mcpOAuthProvider }),
);
app.use(`${prefix}/token`, tokenHandler({ provider: mcpOAuthProvider }));
app.use(`${prefix}/revoke`, revocationHandler({ provider: mcpOAuthProvider }));
app.post(
  `${prefix}/consent`,
  express.urlencoded({ extended: false, limit: "8kb" }),
  async (req, res) => {
    const { base, issuer } = getMcpOAuthUrls();
    if (req.headers.origin !== new URL(base).origin) {
      res.sendStatus(403);
      return;
    }
    const session = await mcpAuth.api.getSession({
      headers: browserHeaders(req.headers.cookie),
    });
    if (!session) {
      res.sendStatus(401);
      return;
    }
    const body = z
      .object({
        request: z.string().max(200),
        decision: z.enum(["approve", "deny"]),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.sendStatus(400);
      return;
    }
    const data = await getMcpAuthorization(
      mcpDb,
      body.data.request,
      session.user.id,
    );
    if (!data) {
      res.sendStatus(400);
      return;
    }
    const redirect = new URL(data.redirectUri);
    redirect.searchParams.set("iss", issuer);
    if (data.state) redirect.searchParams.set("state", data.state);
    if (body.data.decision === "approve") {
      const result = await approveMcpAuthorization(
        mcpDb,
        body.data.request,
        session.user.id,
      );
      if (!result) {
        res.sendStatus(400);
        return;
      }
      redirect.searchParams.set("code", result.code);
    } else {
      await oauthRepo.deleteRequest(mcpDb, hashToken(body.data.request));
      redirect.searchParams.set("error", "access_denied");
    }
    res.redirect(303, redirect.href);
  },
);
app.post(
  `${prefix}/disconnect`,
  express.urlencoded({ extended: false, limit: "8kb" }),
  async (req, res) => {
    if (req.headers.origin !== new URL(getMcpOAuthUrls().base).origin) {
      res.sendStatus(403);
      return;
    }
    const session = await mcpAuth.api.getSession({
      headers: browserHeaders(req.headers.cookie),
    });
    if (!session) {
      res.sendStatus(401);
      return;
    }
    const body = z
      .object({ publicId: z.string().length(12) })
      .safeParse(req.body);
    if (!body.success) {
      res.sendStatus(400);
      return;
    }
    await oauthRepo.revokeGrant(mcpDb, body.data.publicId, session.user.id);
    res.redirect(303, "/mcp");
  },
);
app.use((_req, res) => {
  res.sendStatus(404);
});

export default withRateLimit(
  { points: 100, duration: 60 },
  (req: NextApiRequest, res: NextApiResponse) => {
    // Next retains the public URL when a well-known path rewrites to this route.
    const action = req.query.action;
    if (typeof action === "string") {
      const queryIndex = req.url?.indexOf("?") ?? -1;
      const query = queryIndex >= 0 ? req.url?.slice(queryIndex) : "";
      req.url = `${prefix}/${encodeURIComponent(action)}${query ?? ""}`;
    }
    return new Promise<void>((resolve) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      app(req, res);
    });
  },
);
