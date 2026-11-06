import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { t } from "@lingui/core/macro";

import { getMcpAuthorization } from "@kan/auth/mcp-oauth";
import * as oauthRepo from "@kan/db/repository/mcp-oauth.repo";

import { PageHead } from "~/components/PageHead";

interface Props {
  email: string;
  request: string | null;
  connections: { publicId: string; createdAt: string }[];
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const { browserHeaders, mcpAuth, mcpDb } = await import(
    "~/server/mcp-oauth-provider"
  );
  ctx.res.setHeader("Cache-Control", "no-store");
  // Keep Origin on same-origin form POSTs without leaking request URLs off-site.
  ctx.res.setHeader("Referrer-Policy", "same-origin");
  ctx.res.setHeader("X-Frame-Options", "DENY");
  ctx.res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  const session = await mcpAuth.api.getSession({
    headers: browserHeaders(ctx.req.headers.cookie),
  });
  if (!session)
    return {
      redirect: {
        destination: `/login?next=${encodeURIComponent(ctx.resolvedUrl)}`,
        permanent: false,
      },
    };
  const request =
    typeof ctx.query.request === "string" ? ctx.query.request : null;
  if (request && !(await getMcpAuthorization(mcpDb, request, session.user.id)))
    return { notFound: true };
  const grants = await oauthRepo.listGrants(mcpDb, session.user.id);
  return {
    props: {
      email: session.user.email,
      request,
      connections: grants.map((grant) => ({
        publicId: grant.publicId,
        createdAt: grant.createdAt.toISOString(),
      })),
    },
  };
}

export default function McpConnections({ email, request, connections }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-light-100 p-6 text-light-1000 dark:bg-dark-50 dark:text-dark-1000">
      <PageHead title={t`Connect ChatGPT | Kan`} />
      <section className="w-full max-w-lg space-y-5 rounded-lg border border-light-500 bg-light-300 p-6 dark:border-dark-400 dark:bg-dark-200">
        <h1 className="text-xl font-bold">{t`Connect ChatGPT to Kan`}</h1>
        <p>{email}</p>
        {request ? (
          <>
            <p>{t`Allow ChatGPT to read your Kan data and create, modify or delete cards and lists using your account permissions?`}</p>
            <p>{t`Review proposed changes in ChatGPT before approving them. You can revoke access here at any time.`}</p>
            <form
              method="post"
              action="/api/mcp/oauth/consent"
              className="flex gap-4"
            >
              <input type="hidden" name="request" value={request} />
              <button
                type="submit"
                name="decision"
                value="approve"
                className="rounded bg-blue-600 px-4 py-2 text-white"
              >{t`Authorize ChatGPT`}</button>
              <button
                type="submit"
                name="decision"
                value="deny"
                className="rounded border px-4 py-2"
              >{t`Cancel`}</button>
            </form>
          </>
        ) : (
          <>
            <p>{t`Connected applications`}</p>
            {!connections.length && <p>{t`No active connections`}</p>}
            {connections.map((connection) => (
              <form
                key={connection.publicId}
                method="post"
                action="/api/mcp/oauth/disconnect"
                className="flex items-center justify-between gap-4 border-t py-3"
              >
                <input
                  type="hidden"
                  name="publicId"
                  value={connection.publicId}
                />
                <span>ChatGPT · {connection.createdAt.slice(0, 10)}</span>
                <button
                  type="submit"
                  className="rounded border px-3 py-2"
                >{t`Revoke access`}</button>
              </form>
            ))}
          </>
        )}
        <Link
          href="/boards"
          className="block underline"
        >{t`Back to boards`}</Link>
      </section>
    </main>
  );
}
