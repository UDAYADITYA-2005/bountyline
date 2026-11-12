# API contract

Base path `/api/v1`. JSON in and out, except photo upload (multipart) and the SSE stream.
Schemas live in `packages/contracts`; this file must match them. OpenAPI is served at
`/api/openapi.json` with a viewer at `/api/docs`.

## Conventions

- Auth: a session cookie `bl_session` (httpOnly, SameSite=Lax, Secure in production). Each route
  below names its level: `public`, `claimant`, `manager`, `judge` (a Judge mode session, which acts
  as a claimant or a manager).
- Unsafe methods must send an `Origin` matching `APP_BASE_URL`, except the PayPal webhook.
- Money is `{ amountMinor: number, currency: "USD" }` plus a display string `formatted: "$8.00"`.
- Times are ISO 8601 UTC strings. IDs are ULIDs.
- Errors are RFC 9457 problem+json: `{ type, title, status, detail, code }`, where `code` is an
  `ErrorCode` such as `CLAIM_NOT_FOUND`, `CODE_EXPIRED`, `INVALID_STATE`, `FORBIDDEN`,
  `RATE_LIMITED`, `VALIDATION_FAILED`, `JUDGE_MODE_OFF`.
- Rate limits return 429 with `Retry-After`.

## Shared shapes

```ts
type CheckView = {
  key: CheckKey; // species | length | code_in_frame | photo_quality | screen_suspected
  // | duplicate | area | season | claim_rate | code_expiry
  status: 'pending' | 'pass' | 'fail' | 'uncertain' | 'skipped' | 'unavailable';
  confidence?: number; // 0..1, vision checks only
  label: string; // "Species", "Photo reuse"
  detail: string; // "Northern pikeminnow (0.92)"
};

type ReasonView = { code: ReasonCode; message: string; checkKey?: CheckKey };

type ClaimView = {
  id: string;
  programId: string;
  programName: string;
  status: ClaimStatus;
  code: string;
  codeExpiresAt: string;
  speciesKey?: string;
  declaredLengthCm?: number;
  photoUrl?: string; // /api/v1/photos/:id
  location?: { lat: number; lng: number; accuracyM: number };
  checks: CheckView[];
  decision?: 'approve' | 'hold' | 'reject';
  reasons: ReasonView[];
  amount?: Money;
  payout?: { status: PayoutJobStatus; paypalItemId?: string; updatedAt: string };
  audit: 'none' | 'requested' | 'passed' | 'failed';
  source: 'app' | 'judge_scenario';
  createdAt: string;
  updatedAt: string;
};
```

`ReasonCode`: `duplicate_exact`, `duplicate_near`, `wrong_species`, `species_uncertain`,
`below_min_length`, `length_uncertain`, `code_missing`, `code_mismatch`, `code_expired`,
`outside_area`, `low_location_accuracy`, `out_of_season`, `claim_rate_exceeded`, `photo_unusable`,
`screen_suspected`, `ai_unavailable`, `check_error`, `pool_insufficient`, `daily_payout_cap`,
`manager_approved`, `manager_rejected`, `payout_failed`, `payout_unclaimed`.

## Endpoints

### Health and docs

| Method and path                          | Auth   | Returns                               |
| ---------------------------------------- | ------ | ------------------------------------- |
| `GET /api/health`                        | public | `{ status: "ok", db: "ok", version }` |
| `GET /api/openapi.json`, `GET /api/docs` | public | OpenAPI document and viewer           |

### Auth

| Method and path       | Auth   | Body                                                         | Returns                 |
| --------------------- | ------ | ------------------------------------------------------------ | ----------------------- |
| `POST /auth/register` | public | `{ email, displayName, password, paypalEmail, ageAttested }` | `{ user }`, sets cookie |
| `POST /auth/login`    | public | `{ email, password }`                                        | `{ user }`, sets cookie |
| `POST /auth/logout`   | any    | none                                                         | 204                     |
| `GET /auth/me`        | any    | none                                                         | `{ user }` or 401       |

`user` is `{ id, email, role, displayName, paypalEmailMasked }`.

### Programs

| Method and path     | Auth   | Returns                                                              |
| ------------------- | ------ | -------------------------------------------------------------------- |
| `GET /programs`     | public | `{ programs: ProgramSummary[] }`                                     |
| `GET /programs/:id` | public | `{ program: ProgramSummary }` with species, tiers, season, area name |

### Claims (claimant)

| Method and path             | Auth                            | Body                                                                                                          | Returns                                                                                      |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /claims`              | claimant                        | `{ programId, speciesKey? }`; header `Idempotency-Key` optional                                               | 201 `{ claim: ClaimView }` with `code`                                                       |
| `POST /claims/:id/evidence` | claimant, owner                 | multipart: `photo` (JPEG, at most 8 MB), `meta` JSON `{ lat, lng, accuracyM, capturedAt, declaredLengthCm? }` | 202 `{ claim }` in `checking`                                                                |
| `GET /claims/:id`           | claimant owner or manager       | none                                                                                                          | `{ claim: ClaimView }`                                                                       |
| `GET /claims/:id/stream`    | claimant owner or manager       | none                                                                                                          | SSE, below                                                                                   |
| `GET /me/claims`            | claimant                        | `?cursor&limit`                                                                                               | `{ claims: ClaimView[], nextCursor?, totals: { paid: Money, pending: Money, seasonCount } }` |
| `GET /photos/:id`           | owner, manager or judge session | none                                                                                                          | `image/jpeg`, `Cache-Control: private, max-age=3600`                                         |

**SSE** `GET /claims/:id/stream`: `Content-Type: text/event-stream`. Sends `event: claim` with a
`ClaimView` whenever `updated_at` changes (polled every 750 ms), a comment heartbeat every 15 s,
and closes 5 s after a final state.

### Desk (manager)

| Method and path                  | Body                                               | Returns                                                          |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /desk/claims`               | `?status&programId&from&to&limit&cursor`           | `{ claims: ClaimView[], nextCursor? }`                           |
| `GET /desk/claims/:id`           | none                                               | `{ claim: ClaimView, history: DecisionLogEntry[] }`              |
| `POST /desk/claims/:id/decision` | `{ decision: "approve" or "reject", note }`        | `{ claim }`; 409 `INVALID_STATE` unless `held` or `payout_issue` |
| `POST /desk/claims/:id/audit`    | `{ action: "request" or "pass" or "fail", note? }` | `{ claim }`                                                      |
| `GET /desk/pool`                 | `?programId`                                       | `{ funded, reserved, released, available, paidToday }` as Money  |
| `GET /desk/data/:table`          | table is `claims`, `payouts`, `ledger` or `audits` | `{ data: Row[] }` flat rows for AG Studio                        |
| `POST /desk/llm`                 | AG Studio `AgLlmRequest`                           | streamed AG-UI events (stretch only)                             |

AG Studio rows are flat and typed for widgets, for example a `claims` row:
`{ id, program, claimant, species, lengthCm, status, decision, amountUsd, submittedAt, lat, lng,
holdReasons, audit }`. `amountUsd` is a display number for charts only; money logic never reads it.

### PayPal

| Method and path        | Auth      | Notes                                               |
| ---------------------- | --------- | --------------------------------------------------- |
| `POST /paypal/webhook` | signature | raw body; 200 after storing; 400 on a bad signature |

### Judge mode (only when `JUDGE_MODE=true`, else 404 `JUDGE_MODE_OFF`)

| Method and path                 | Body                              | Returns                                                                                      |
| ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /judge/session`           | `{ as: "claimant" or "manager" }` | sets a judge cookie; creates an ephemeral claimant paid to the sandbox personal account      |
| `GET /judge/scenarios`          | none                              | `{ scenarios: { id, title, story, programId, expect, photoUrl }[] }`                         |
| `POST /judge/scenarios/:id/run` | none                              | 201 `{ claim }`: claim created, sample photo and simulated location attached, checks started |

Judge claims are scoped to the judge session: duplicate search, claim rate and reward tiers only
see that session's claims plus the seeded history.

## As built (Nov 11, 2026)

These match `packages/contracts` and the routes; they extend the contract above.

- `GET /api/health` returns `{ status: "ok", db: "ok" | "skipped" | "error", version, judgeMode }`.
- `user` also carries `judge: boolean`; `email` is masked except for Judge claimants.
- `ClaimView` also carries `scenarioId?`. While `checking`, all ten checks are listed with status
  `pending`. `reasons` holds one entry per reason code.
- `GET /me/claims` `totals` also carries `tierProgress: { programId, seasonCount, currentAmount, nextTierAt }[]`.
- `GET /desk/claims?status=held,payout_issue`: `status` is a comma-separated list, each parsed as a
  `ClaimStatus` (400 on an unknown value).
- `POST /desk/claims/:id/decision`: approving a held claim runs the budget guard; when it fails, the
  answer is 200 with the claim still `held` and the budget reason added. While the payout is
  UNCLAIMED at PayPal, both approve and reject answer 409 `INVALID_STATE` (ADR 0007).
- `GET /desk/pool` returns `{ pools: PoolView[] }`, one per program, each with `programId`.
- `GET /desk/data/:table` rows:
  - `claims`: `id, program, programId, claimant, species, lengthCm, status, decision, amountUsd,
submittedAt, decidedAt, lat, lng, holdReasons, audit, source, photoUrl`
  - `payouts`: `claimId, program, status, attempt, tries, amountUsd, paypalBatchId, paypalItemId,
lastError, updatedAt`
  - `ledger`: `id, program, kind, amountUsd, signedAmountUsd, claimId, source, createdAt`
  - `audits`: `claimId, program, claimant, audit, amountUsd, paidAt`
- `POST /judge/session` returns `{ user }`. With `JUDGE_MODE=true`, `/auth/register` and claimant
  password logins answer 403 (the deployment holds demo data only).
- `GET /judge/scenarios/:id/photo` (public in Judge mode) serves the scenario's sample photo;
  `ScenarioView.photoUrl` points at it and `realCode` says whether the code check runs for real.
- `POST /judge/scenarios/:id/run` answers 201 with the claim as it was when evidence landed
  (`checking`); follow it with `GET /claims/:id` or the SSE stream.
- `/api/docs` and static web files are public; every route under `/api/v1` declares its auth level
  and anything undeclared is denied.
