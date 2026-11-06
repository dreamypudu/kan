![github-background](https://github.com/user-attachments/assets/f728f52e-bf67-4357-9ba2-c24c437488e3)

<div align="center">
  <h3 align="center">Kan</h3>
  <p>The open-source project management alternative to Trello.</p>
</div>

<p align="center">
  <a href="https://kan.bn/kan/roadmap">Roadmap</a>
  ·
  <a href="https://kan.bn">Website</a>
  ·
  <a href="https://docs.kan.bn">Docs</a>
  ·
  <a href="https://github.com/kanbn/kan/discussions">Discussions</a>
</p>

<div align="center">
  <a href="https://github.com/kanbn/kan/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPLv3-purple"></a>
</div>

## Features

- **Board Visibility**: Control who can view and edit your boards
- **Workspace Members**: Invite members and collaborate with your team
- **Trello Imports**: Easily import your Trello boards
- **Labels & Filters**: Organise and find cards quickly
- **Comments**: Discuss and collaborate with your team
- **Activity Log**: Track all card changes with detailed activity history
- **Templates**: Save time with reusable custom board templates
- **Integrations (coming soon)**: Connect your favourite tools

See our [roadmap](https://kan.bn/kan/roadmap) for upcoming features.

## Screenshot

<img width="1507" alt="hero-dark" src="https://github.com/user-attachments/assets/8490104a-cd5d-49de-afc2-152fd8a93119" />

## Made With

- [Next.js](https://nextjs.org/?ref=kan.bn)
- [tRPC](https://trpc.io/?ref=kan.bn)
- [Better Auth](https://better-auth.com/?ref=kan.bn)
- [Tailwind CSS](https://tailwindcss.com/?ref=kan.bn)
- [Drizzle ORM](https://orm.drizzle.team/?ref=kan.bn)
- [React Email](https://react.email/?ref=kan.bn)

## Self Hosting

### One-click Deployments

The easiest way to deploy Kan is through Railway. We've partnered with Railway to maintain an official template that supports the development of the project.

<a href="https://railway.com/deploy/kan?referralCode=bZPsr2&utm_medium=integration&utm_source=template&utm_campaign=generic">
  <img src="https://railway.app/button.svg" alt="Deploy on Railway" height="40" />
</a>

### Deploy a fork on Railway

Use the repository root (`/`) as the service **Root Directory** and
`/railway.json` as its **Config File Path**. The checked-in configuration selects
`apps/web/Dockerfile` instead of Railpack. Keep the full monorepo as the build
context: setting the root to `apps/web` would exclude the shared packages and
lockfile.

The official multi-stage Dockerfile installs with the frozen pnpm lockfile,
builds `@kan/web` and its dependencies with Node 24, and packages the Next.js
standalone server. The final `web` stage runs as a non-root user. Its default
command starts `bootstrap.cjs`, which injects runtime public variables, optionally
runs migrations, and starts the server. Clear any custom build, start, or
pre-deploy commands previously configured in Railway; the image already handles
these tasks. In particular, do not use `pnpm start` in the distroless image.

1. Add a Railway **PostgreSQL** service in the same project and environment. Keep
   its persistent volume and use its private connection URL.
2. Connect the fork's branch to the Kan web service and configure these variables:

   | Variable | Value |
   | --- | --- |
   | `POSTGRES_URL` | `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the actual database service name) |
   | `BETTER_AUTH_SECRET` | A stable, randomly generated secret of at least 32 characters |
   | `NEXT_PUBLIC_BASE_URL` | The final public HTTPS URL, without a trailing slash |
   | `NEXT_PUBLIC_ALLOW_CREDENTIALS` | `true` to enable email/password signup and login, unless using OAuth/OIDC instead |
   | `RUN_MIGRATIONS` | `true` to apply the checked-in Drizzle migrations before each server start |
   | `PORT` | `3000` |
   | `HOSTNAME` | `0.0.0.0` (already the image default; do not override with a hostname) |

3. Generate a public domain in Railway and set its target port to **3000**. Set
   `NEXT_PUBLIC_BASE_URL` to that domain (or your custom domain), then deploy.
   `NODE_ENV=production` is already set by the image. Public variables are injected
   at startup; database credentials and auth secrets do not need build arguments.
4. Use **one web replica** with startup migrations. The existing bootstrap aborts
   startup if migrations fail; do not also run a separate migration command.
   Coordinate migrations separately before scaling to concurrent replicas.
5. Check deployment logs for successful migrations and server startup. Railway
   checks `/api/health`, which returns 200 only when a PostgreSQL query succeeds;
   the configured timeout is 300 seconds. Verify signup, login, board/card creation,
   and persistence after a redeploy.

Email delivery requires the existing SMTP variables (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, and `SMTP_SECURE` as appropriate).
Alternatively, set `NEXT_PUBLIC_DISABLE_EMAIL=true` if email features are not
needed. Attachments and avatars require S3-compatible storage and the matching
variables in [.env.example](./.env.example). Redis and OAuth/OIDC remain optional.
Do not leave `POSTGRES_URL` empty: the local PGlite fallback is not persistent
storage for a Railway web container. Back up PostgreSQL before deploying schema
changes.

The Dockerfile uses standard Docker layer caching rather than service-specific
BuildKit cache mounts so the same file works on Railway and Docker Compose.
Rebuilds after dependency or source changes may take longer. No application code
or security checks are disabled by this deployment configuration.
The TypeScript package exclusion is scoped to `node_modules/typescript` so it
does not remove Next.js's internal `lib/typescript` modules needed at startup.

To verify the complete image locally on a machine with Docker:

```bash
docker build --target web -f apps/web/Dockerfile -t kan-railway .
docker run --rm --env-file .env -e RUN_MIGRATIONS=true -p 3000:3000 kan-railway
```

For this local check, `.env` must use a PostgreSQL URL reachable from the container.
Then check `http://localhost:3000/api/health`. See Railway's
[Dockerfile documentation](https://docs.railway.com/builds/dockerfiles) and
[configuration reference](https://docs.railway.com/config-as-code/reference).

### Docker Compose

Alternatively, you can self-host Kan with Docker Compose. This will set up everything for you including your postgres database and automatically run migrations.

1. Create a `.env` file with your environment variables (see [Environment Variables](#environment-variables) section below)

2. Use the [docker-compose.yml](./docker-compose.yml) file provided in the repository, which sets up Postgres, runs migrations, and starts the web service

3. Start the containers in detached mode:

```bash
docker compose up -d
```

The application will be available at http://localhost:3000 (or the port specified in `WEB_PORT`).

**Managing containers:**

- To stop the containers: `docker compose down`
- To view logs: `docker compose logs -f`
- To restart the containers: `docker compose restart`
- To rebuild after code changes: `docker compose up -d --build`

## Local Development

1. Clone the repository (or fork)

```bash
git clone https://github.com/kanbn/kan.git
```

2. Install dependencies

```bash
pnpm install
```

3. Copy `.env.example` to `.env` and configure your environment variables
4. Migrate database

```bash
pnpm db:migrate
```

5. Start the development server

```bash
pnpm dev
```

## Environment Variables

At minimum, you'll need:

| Variable               | Description                   | Example                                  |
| ----------------------- | ------------------------------ | ----------------------------------------- |
| `POSTGRES_URL`          | PostgreSQL connection URL      | `postgres://user:pass@localhost:5432/db`  |
| `NEXT_PUBLIC_BASE_URL`  | Base URL of your installation  | `http://localhost:3000`                   |
| `BETTER_AUTH_SECRET`    | Auth encryption secret         | Random 32+ char string                    |

Optional integrations (email/SMTP, OAuth and OIDC login, S3-compatible file storage, Trello import, rate limiting, white labelling, and more) are configured through additional variables. See [.env.example](./.env.example) for the complete list.

## MCP Server

For the COMPASS document-to-task workflow operated from Codex, see
[Documentos de COMPASS a Kan](docs/compass-actas.md).

Kan ships with a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets any MCP-compatible AI client (Claude Desktop, Codex, Cursor, GitHub Copilot, and others) read and control your Kan instance using natural language.

Run it with `npx`, no clone or global install required:

```bash
npx -y @kan.bn/mcp
```

Configure it with two environment variables: `KAN_BASE_URL` (your Kan instance) and `KAN_API_TOKEN` (from **Settings → API Keys**). Then point your client's MCP config at the `npx -y @kan.bn/mcp` command.

See the [MCP Server docs](https://docs.kan.bn/integrations/mcp-server) for per-client config (Claude Desktop, Codex, and others), example prompts, the full tool reference, and troubleshooting.

Self-hosted ChatGPT connections can use OAuth with PKCE and ChatGPT's official client metadata (CIMD) at `/api/mcp`. Users sign in with their own Kan account, approve access, and can revoke it at `/mcp`. See [Railway deployment and ChatGPT setup](docs/compass-actas.md#conectar-chatgpt-a-railway), including supported operations and document-upload limitations.

## Contributing

We welcome contributions! Please read our [contribution guidelines](CONTRIBUTING.md) before submitting a pull request.

## Contributors

<a href="https://github.com/kanbn/kan/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=kanbn/kan" />
</a>

## Sponsors

[<img height="100" alt="image" src="https://github.com/user-attachments/assets/e331c71f-ac86-46a6-bceb-ce276de094b0" />](https://www.testmuai.com)

Proudly sponsored by [TestMu AI (formerly LambdaTest)](https://www.testmuai.com) - an AI-native testing cloud platform built for modern engineering teams. Covering everything from autonomous test creation and fast execution to testing AI agents like chatbots and voice assistants. If you're serious about testing, go check them out.

## License

Kan is licensed under the [AGPLv3 license](LICENSE).

## Contact

For support or to get in touch, please email [henry@kan.bn](mailto:henry@kan.bn) or start a [GitHub Discussion](https://github.com/kanbn/kan/discussions).
