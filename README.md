# Bountyline

[![CI](https://github.com/UDAYADITYA-2005/bountyline/actions/workflows/ci.yml/badge.svg)](https://github.com/UDAYADITYA-2005/bountyline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)

**Wildlife bounty claims checked by AI and paid by PayPal in minutes.**

A claimant photographs a removed fish with a one-time code in the frame. Gemini reports what it sees,
a deterministic rules engine decides, and PayPal Payouts (sandbox) pays the claimant's email. Program
managers clear held claims and order hand-in audits on an AG Studio desk. The model never moves money.

> Bountyline. Prove it, get paid.

## Contents

- [Try it](#try-it)
- [How it works](#how-it-works)
- [PayPal integration](#paypal-integration)
- [AI checks](#ai-checks)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [License](#license)

## Try it

**Live demo:** `https://<service>.onrender.com/judge`

Judge mode needs no account. Open `/judge` and press **Run** on a scenario. Each run creates a real
claim with a sample photo and a simulated location, runs every check, and pays approved claims to a
PayPal sandbox account. Simulated parts are labelled on screen.

To review claims, choose **Open the desk** on `/judge`, or sign in at `/login` as
`manager@bountyline.demo` with the password published in the submission.

| Scenario             | Expected     | Demonstrates                                      |
| -------------------- | ------------ | ------------------------------------------------- |
| `clean-pikeminnow`   | approve, $6  | the full path to a PayPal payout                  |
| `clean-pikeminnow-2` | approve, $6  | reward tiers counted per claimant                 |
| `reused-photo`       | reject       | duplicate detection (SHA-256 and perceptual hash) |
| `out-of-area`        | hold         | geofencing; a manager clears it and it pays       |
| `wrong-species`      | reject       | a look-alike species caught by the vision check   |
| `undersized`         | reject       | minimum length                                    |
| `pike-clean`         | approve, $10 | a second program with a flat rate                 |

## How it works

```
 claimant / Judge hub ──► Fastify API ──► checks (in process, or Render Workflows)
                            │               ├─ Gemini vision: species, length, code, quality, screen
                            │               └─ duplicates, geofence, season, claim rate, code expiry
                            │                          │  observations only
                            ▼                          ▼
                     rules engine (packages/core) ──► approve | hold | reject + reason codes
                            │  approve: reservation + payout job in one transaction
                            ▼
                     payout dispatcher ──► PayPal Payouts ──► verified webhook ──► paid
                            ▲                                   reconciler covers lost webhooks
                     AG Studio desk: held claims, audits, pool balance
```

- **The model proposes, code decides.** Gemini returns observations against a fixed schema and never
  sees the issued code or the declared species. A missing, uncertain or unavailable check holds the
  claim; it never approves it.
- **Exactly-once payouts.** The approval writes a payout job (an outbox) in the same transaction as the
  pool reservation. The `sender_batch_id` is the claim ID, so retries can't pay twice.
- **Enforced boundaries.** ESLint enforces the package dependency graph; `packages/checks` cannot
  import `packages/paypal`, and `packages/core` is pure (no I/O, clock or randomness).

## PayPal integration

| Call                                  | Purpose                                                     | Source                           |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `POST /v1/oauth2/token`               | client-credentials token, cached with one in-flight refresh | `packages/paypal/src/client.ts`  |
| `POST /v1/payments/payouts`           | one batch per claim                                         | `packages/paypal/src/payouts.ts` |
| `GET /v1/payments/payouts/{batch_id}` | reconciliation when a webhook is lost                       | `packages/paypal/src/payouts.ts` |
| Webhooks `PAYMENT.PAYOUTS-ITEM.*`     | self-verified signature, stored by event ID, then applied   | `packages/paypal/src/webhook.ts` |

Only `apps/api/src/services/payout-service.ts` holds a payout gateway. Everything runs against the
PayPal sandbox; any other `PAYPAL_ENV` fails at boot.

## AI checks

| Model                                       | Role                                                               | Source                              |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Gemini (`GEMINI_MODEL`, default Flash-Lite) | one structured call per photo: species, length, code text, quality | `packages/checks/src/vision/`       |
| none                                        | maps findings to checks and decides                                | `packages/core/src/rules/decide.ts` |

Results are cached by photo hash, model and prompt version, behind a daily quota guard. See
[docs/AI_CHECKS.md](docs/AI_CHECKS.md) for the prompt, schema and thresholds.

## Getting started

**Requirements:** Node.js 22 or newer, pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/UDAYADITYA-2005/bountyline.git
cd bountyline
pnpm install
cp .env.example .env        # fill in the values described in the file
pnpm seed                   # migrations, demo manager, pool funding, seeded history
pnpm dev                    # API on :3000, web on :5173
```

Open http://localhost:5173/judge. Local development uses PGlite (Postgres 17 in WebAssembly), so no
database install is needed. Without PayPal or Gemini keys the app still runs: claims are held for
review instead of approved.

Sample photos live in `samples/photos/` and are listed in [samples/CREDITS.md](samples/CREDITS.md).

## Scripts

| Command                        | Description                                               |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm dev`                     | API and web app in watch mode                             |
| `pnpm verify`                  | lint, typecheck and the full test suite (what CI runs)    |
| `pnpm test`                    | tests only (Vitest, PGlite, no network)                   |
| `pnpm build`                   | production build of the web app and the API               |
| `pnpm seed`                    | idempotent seed: manager, pool funding, history           |
| `pnpm db:generate`             | generate a migration from `packages/db/src/schema.ts`     |
| `pnpm db:migrate`              | apply migrations to `DATABASE_URL`                        |
| `pnpm env:check`               | which environment variables are set (never prints values) |
| `pnpm paypal:smoke`            | one real $1.00 sandbox payout                             |
| `pnpm eval:checks --runs 3`    | live Gemini evaluation over the scenario pack             |
| `pnpm gate1 --url <base>`      | end-to-end payout check against a deployed instance       |
| `pnpm judge:warm --url <base>` | run every scenario once to warm the vision cache          |

## Project layout

```
apps/
  api/          Fastify server: routes, services, payout dispatcher, reconciler, CLI scripts
  web/          React + Vite: claimant app, Judge hub, AG Studio desk
  workflows/    Render Workflows tasks that run claim checks
packages/
  contracts/    zod schemas shared by api and web
  core/         pure domain: money, claim state machine, rules engine, budget guard
  config/       environment and program file validation
  db/           Drizzle schema, migrations, repositories
  paypal/       PayPal REST client, payouts, webhook verification
  checks/       photo ingest, perceptual hashes, deterministic checks, Gemini provider
programs/       reward program definitions (YAML)
samples/        Judge mode scenarios and sample photos
docs/           architecture, API, data model, PayPal, AI checks, security, testing, deployment
```

## Deployment

The repository ships a Render Blueprint ([render.yaml](render.yaml)): one web service and one Postgres
database. See [docs/DEPLOY.md](docs/DEPLOY.md) for the environment variables, the PayPal webhook set-up
and the release routine.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Data model](docs/DATA_MODEL.md)
- [PayPal](docs/PAYPAL.md) · [AI checks](docs/AI_CHECKS.md) · [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md) · [Judge mode](docs/JUDGE_MODE.md) · [Product](docs/PRODUCT.md)
- [Decision records](docs/decisions/)

## License

[MIT](LICENSE). The demo programs are modeled on the WDFW/BPA Northern Pikeminnow Sport-Reward Fishery
and the Colville Tribes' northern pike reward; program boundaries are simplified and not official.
