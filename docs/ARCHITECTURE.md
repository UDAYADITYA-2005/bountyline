# Architecture

A modular monolith in one pnpm workspace, deployed as two Render services and one database.
The design rule that shapes everything: **the model proposes, plain code decides, and only one
worker can move money.**

## Runtime

| Process                              | Where                                      | Does                                                                                                      |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `bountyline` web service             | Render, `starter` plan                     | Fastify API under `/api`, serves the built React app, runs the payout dispatcher and the reconciler loops |
| `bountyline-checks` workflow service | Render Workflows                           | Runs `runClaimChecks(claimId)`, fanning out vision and duplicate search as parallel subtasks              |
| `bountyline-db`                      | Render Postgres `basic-256mb`, Postgres 17 | All state                                                                                                 |
| Outside APIs                         | PayPal sandbox, Gemini API                 | Payouts and webhooks; photo analysis                                                                      |

Locally, `pnpm dev` runs the API and Vite; `CHECK_RUNNER=inline` runs checks in the API process.
Tests use PGlite (Postgres 17 in WebAssembly) and fakes for every outside API.

## Packages and the dependency rule

```
packages/contracts   zod only. Request/response schemas, enums (ClaimStatus, CheckKey,
                     ReasonCode, ErrorCode), shared types. Imported by api and web.
packages/core        imports contracts. Pure domain: Money, Clock/Random ports, claim state
                     machine, rules engine (decide), reward tiers, budget guard, audit sampling,
                     DomainError.
packages/config      imports contracts, core. Env parsing (zod), program YAML loading and
                     validation, scenario pack loading.
packages/db          imports contracts, core. Drizzle schema, migrations, repositories,
                     createTestDb() for tests.
packages/paypal      imports core, config. OAuth, Payouts client, webhook verification and
                     event parsing. Implements the PayoutGateway port.
packages/checks      imports core, config, db. Photo ingest (sharp), perceptual hashes,
                     geofence, season, claim rate, Gemini vision provider, quota guard,
                     runAllChecks(). Must not import paypal.
apps/api             imports everything except web. Composition root.
apps/workflows       imports checks, core, config, db. Render Workflows task definitions.
apps/web             imports contracts only.
```

An ESLint `no-restricted-imports` rule per package enforces this table.

## Ports (interfaces owned by core)

- `Clock { now(): Date }` and `Random { next(): number }`: injected everywhere time or chance
  matters. Tests use `FixedClock` and `SeededRandom`.
- `PayoutGateway { createPayout(req): PayoutCreated; getPayoutBatch(batchId): PayoutBatchStatus }`:
  implemented by `packages/paypal`, faked by `FakePayoutGateway`.
- `VisionProvider { analyze(input): VisionFindings }`: implemented by the Gemini provider in
  `packages/checks`, faked by `FakeVisionProvider`.
- `CheckRunner { start(claimId): void }`: in `apps/api`. `InlineCheckRunner` calls
  `runClaimChecks` in process; `RenderWorkflowsCheckRunner` starts the workflow task and falls
  back to inline if Render refuses.

## Flows

### 1. Start a claim

`POST /api/v1/claims` → service validates the program and the claimant's eligibility → core
creates a claim in `code_issued` with a one-time code (alphabet without 0/O/1/I, format `K7-42`)
that expires after the program's `codeTtlMinutes` → response carries the code.

### 2. Submit evidence

`POST /api/v1/claims/:id/evidence` (multipart: JPEG plus JSON with location, accuracy,
`capturedAt` and declared length) → photo ingest: decode with sharp, rotate, resize to 1600 px,
re-encode JPEG q85, strip metadata, compute SHA-256, dHash and pHash → store photo → transition to
`checking` → `CheckRunner.start(claimId)`.

### 3. Check and decide

`runClaimChecks(claimId)`:

1. Load claim, photo, program, and the claimant's history (count this season, claims today,
   payouts today by PayPal email).
2. In parallel: vision analysis (one Gemini call, cached), duplicate search (Hamming distance on
   pHash against prior claims in scope), and the pure checks (area, season, rate, code expiry).
3. Map vision findings to checks: species, length, code in frame, photo quality, screen or print
   suspected.
4. `core.decide(input)` returns `approve`, `hold` or `reject` with reason codes and, for approve,
   the amount from the program's tiers.
5. For approve, `core.guardBudget()` checks the pool and the per-receiver daily cap.
6. One transaction: write check results, the decision, a `decision_log` row, and for an approved
   claim a ledger `reserve` entry and a `payout_jobs` row. Claim goes to `approved`, `held` or
   `rejected`.

### 4. Pay

The payout dispatcher (every 2 s) locks due jobs with `FOR UPDATE SKIP LOCKED` and calls
`PayoutGateway.createPayout` with `sender_batch_id` = claim ID. On 201 it stores the batch ID and
moves the claim to `paying`. Network errors and 5xx retry with the same ID and backoff; other 4xx
move the claim to `payout_issue`.

### 5. Confirm

`POST /api/v1/paypal/webhook`: raw body → self-verify the signature → insert into
`webhook_events` (duplicate event IDs stop here with 200) → map the event to the claim through
`sender_item_id` → transition `paying → paid` or `paying → payout_issue`. The reconciler (every
60 s) asks PayPal about jobs still `sent` after 2 minutes, so a lost webhook can't strand a claim.

### 6. Review on the desk

Held claims show on the desk with their reasons. `POST /api/v1/desk/claims/:id/decision`
(`approve` or `reject`, with a note) runs the same budget guard and transaction as flow 3. A
manager decision is logged with the manager's ID. Paid claims are sampled for audit
deterministically (`hash(claimId) mod 100 < sampleRatePercent`).

## Claim states

```
code_issued ──evidence──▶ checking ──decide──▶ approved ──dispatch──▶ paying ──webhook──▶ paid
     │                       │   └──────────▶ held ──manager approve──▶ approved
     ▼                       └──────────────▶ rejected ◀──manager reject── held
  expired                                    payout_issue ◀──fail── paying
                                             payout_issue ──manager retry──▶ approved
                                             payout_issue ──manager reject──▶ rejected (reservation released)
```

Final states: `paid`, `rejected`, `expired`. Audit is a separate field on paid claims:
`none → requested → passed | failed`.

## Failure modes

| Failure                           | What happens                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Gemini down, 429 or over quota    | Vision checks `unavailable` → claim held with `ai_unavailable`                                     |
| Gemini returns invalid JSON twice | Vision checks `uncertain` → held                                                                   |
| Workflows refuses a start         | Inline runner takes over; a warning is logged                                                      |
| PayPal 5xx or timeout on create   | Retry with the same `sender_batch_id`, backoff 2, 4, 8, 16, 32 s, then hourly                      |
| PayPal says duplicate batch ID    | Treat as already sent; read the batch ID from the error link                                       |
| PayPal 4xx (validation, funds)    | `payout_issue` with the PayPal error name; reservation kept until a manager decides                |
| Webhook lost                      | Reconciler finds the job and fetches the batch                                                     |
| Webhook replayed or out of order  | Stored once by event ID; final states never move backwards                                         |
| Pool empty                        | Budget guard holds the claim with `pool_insufficient`                                              |
| Server restarts mid-dispatch      | Jobs stuck in `sending` for 2 minutes go back to `queued`; the same sender ID makes the retry safe |

## Decisions

See `docs/decisions/`. Summary:

- 0001: TypeScript modular monolith in a pnpm workspace.
- 0002: the model proposes, the rules engine decides, one worker pays.
- 0003: payout outbox, PayPal idempotency by sender ID, self-verified webhooks, reconciler.
- 0004: Gemini Flash-Lite by default, results cached by photo hash, daily quota guard.
- 0005: check runner with an inline fallback and Render Workflows in production.
- 0006: Judge mode with sample photos and simulated location; code check skipped only there.
