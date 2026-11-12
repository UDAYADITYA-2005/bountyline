# Deploy

Render Blueprint (`render.yaml`): one web service, one workflow service, one Postgres. Deploy on
day one, and on every green step after that.

## Services

| Name                | Type           | Plan                          | Build                                                                                               | Start                                       |
| ------------------- | -------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `bountyline`        | web, node      | `starter` (0.5 CPU, 512 MB)   | `corepack enable && pnpm install --frozen-lockfile && pnpm build`                                   | `pnpm --filter @bountyline/api start`       |
| `bountyline-checks` | workflow, node | set per task in code (`flex`) | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @bountyline/workflows... build` | `pnpm --filter @bountyline/workflows start` |
| `bountyline-db`     | Postgres 17    | `basic-256mb`                 |                                                                                                     |                                             |

Health check: `GET /api/health`. Region: Oregon for all three (Workflows tasks reach the database
over the private network in the same region).

## Environment

| Variable                                      | Service          | Value                                                 |
| --------------------------------------------- | ---------------- | ----------------------------------------------------- |
| `DATABASE_URL`                                | both             | from the database (`fromDatabase`)                    |
| `SESSION_SECRET`                              | web              | generated                                             |
| `APP_BASE_URL`                                | web              | `https://<name>.onrender.com`                         |
| `PAYPAL_ENV`                                  | both             | `sandbox`                                             |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`    | web              | from the sandbox app                                  |
| `PAYPAL_WEBHOOK_ID`                           | web              | from the sandbox webhook                              |
| `GEMINI_API_KEY`                              | both             | from AI Studio                                        |
| `GEMINI_MODEL`                                | both             | `gemini-3.5-flash-lite`                               |
| `GEMINI_DAILY_REQUEST_LIMIT`                  | both             | `450`                                                 |
| `CHECK_RUNNER`                                | web              | `render` (falls back to inline)                       |
| `RENDER_API_KEY`                              | web              | for starting workflow runs                            |
| `RENDER_WORKFLOW_SLUG`                        | web              | `bountyline-checks`                                   |
| `JUDGE_MODE`                                  | web              | `true`                                                |
| `DEMO_MANAGER_EMAIL`, `DEMO_MANAGER_PASSWORD` | web              | for the seeded manager; also in the README for judges |
| `DEMO_CLAIMANT_PAYPAL_EMAIL`                  | web              | the sandbox personal account                          |
| `VITE_AG_STUDIO_LICENSE_KEY`                  | web (build time) | set on or after Nov 1                                 |

Secrets marked `sync: false` in the Blueprint are entered once in the dashboard.

## Release routine

1. `pnpm verify` green locally and in CI.
2. Push to `main`; Render auto-deploys. The api's `start` script runs migrations, the idempotent seed and
   then the server (`node dist/migrate.js && node dist/seed.js && node dist/server.js`), so a failed
   migration fails the deploy instead of serving a broken schema.
3. Open `/api/health`, run the clean Judge scenario, check the sandbox personal account.
4. After a deploy that changes prompts or photos, warm the vision cache: run each scenario once.

## Cost against the $50 credits

[Likely] Web `starter` $7 a month plus Postgres `basic-256mb` $6 a month is about $13 a month, so
about $22 from Oct 27 to Dec 15. Workflows bill per task-second on `flex` and should add little at
demo volume. Check the billing page weekly; don't use the free web plan or free Postgres (free
Postgres is deleted 44 days after creation, and free web services sleep).

## Keep alive through judging

From Dec 1 to Dec 15, open the app and run the clean scenario every day. Check the sandbox business
balance and Gemini quota. Don't deploy during judging unless something is broken.
