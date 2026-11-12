# Data model

Postgres 17. Drizzle schema in `packages/db/src/schema.ts`. Money is integer cents (`*_minor`),
timestamps are `timestamptz`, IDs are ULID `text` unless noted. Enums mirror the zod enums in
`@bountyline/contracts`.

## Tables

### users

| Column           | Type             | Notes                                   |
| ---------------- | ---------------- | --------------------------------------- |
| id               | text PK          | ULID                                    |
| email            | text unique      | login, lower-cased                      |
| role             | enum `user_role` | `claimant`, `manager`                   |
| display_name     | text             |                                         |
| password_hash    | text null        | argon2id; null for judge claimants      |
| paypal_email     | text null        | payout receiver; required for claimants |
| age_attested_at  | timestamptz null | set when the claimant confirms 17+      |
| judge_session_id | text null        | set for ephemeral Judge mode claimants  |
| created_at       | timestamptz      |                                         |

### sessions

`id` text PK (random 32 bytes, base64url), `user_id` FK, `expires_at`, `created_at`.
Index: `(user_id)`.

### programs

`id` text PK (from YAML), `version` integer, `config` jsonb (validated program), `loaded_at`.
Loaded from `programs/*.yaml` at boot; a changed file bumps `version`.

### claims

| Column                 | Type                  | Notes                                                                                                  |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| id                     | text PK               | ULID; also the PayPal sender ID                                                                        |
| program_id             | text FK               |                                                                                                        |
| program_version        | integer               | the rules version that decided it                                                                      |
| claimant_id            | text FK users         |                                                                                                        |
| status                 | enum `claim_status`   | `code_issued`, `checking`, `approved`, `held`, `rejected`, `paying`, `paid`, `payout_issue`, `expired` |
| code                   | text                  | one-time code shown to the claimant                                                                    |
| code_expires_at        | timestamptz           |                                                                                                        |
| species_key            | text null             | declared species                                                                                       |
| declared_length_cm     | numeric(5,1) null     |                                                                                                        |
| photo_id               | text null FK photos   |                                                                                                        |
| lat, lng               | double precision null |                                                                                                        |
| location_accuracy_m    | integer null          |                                                                                                        |
| captured_at            | timestamptz null      | client-reported                                                                                        |
| submitted_at           | timestamptz null      | server time                                                                                            |
| decided_at             | timestamptz null      |                                                                                                        |
| decision               | enum `decision` null  | `approve`, `hold`, `reject`                                                                            |
| reasons                | jsonb                 | array of `{ code, message, checkKey? }`                                                                |
| amount_minor           | integer null          | set on approve                                                                                         |
| currency               | text                  | `USD`                                                                                                  |
| source                 | enum `claim_source`   | `app`, `judge_scenario`                                                                                |
| scenario_id            | text null             | Judge mode scenario                                                                                    |
| audit_status           | enum `audit_status`   | `none`, `requested`, `passed`, `failed`                                                                |
| created_at, updated_at | timestamptz           |                                                                                                        |

Indexes: `(claimant_id, created_at)`, `(program_id, status)`, `(status, updated_at)`.

### photos

`id`, `sha256` text (not unique: duplicates must be stored to be detected), `phash` bigint,
`dhash` bigint, `mime` text, `width`, `height`, `bytes` bytea (normalised JPEG, at most about
400 KB), `sample` boolean (Judge mode sample photo), `created_at`.
Indexes: `(sha256)`, `(phash)`.

### claim_checks

`claim_id` FK, `check_key` enum `check_key` (`species`, `length`, `code_in_frame`, `photo_quality`,
`screen_suspected`, `duplicate`, `area`, `season`, `claim_rate`, `code_expiry`), `status` enum
(`pass`, `fail`, `uncertain`, `skipped`, `unavailable`), `confidence` real null, `detail` text,
`evidence` jsonb null, `created_at`. PK `(claim_id, check_key)`.

### vision_results

`photo_sha256` text, `model` text, `prompt_version` integer, `result` jsonb, `created_at`.
PK `(photo_sha256, model, prompt_version)`. The cache that keeps Judge mode free of quota after
the first run of each scenario.

### gemini_usage

`day` date PK (Pacific time, matching Google's quota reset), `requests` integer.

### ledger_entries

| Column       | Type               | Notes                                                                |
| ------------ | ------------------ | -------------------------------------------------------------------- |
| id           | bigserial PK       |                                                                      |
| program_id   | text FK            |                                                                      |
| kind         | enum `ledger_kind` | `funding`, `reserve`, `release`                                      |
| amount_minor | integer            | always positive; the kind gives the sign                             |
| claim_id     | text null          | for `reserve` and `release`                                          |
| source       | text               | `seed`, `judge_top_up`, `checkout:<order id>`, `decision`, `manager` |
| created_at   | timestamptz        |                                                                      |

Available pool = funding − reserve + release. Unique: one `reserve` per claim, one `release` per
claim.

### payout_jobs

| Column          | Type                     | Notes                                                                |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| claim_id        | text PK FK               | one job per claim                                                    |
| attempt         | integer                  | 0 on first send; a manager retry after a final failure increments it |
| sender_batch_id | text unique              | `claimId`, or `claimId-r{attempt}`                                   |
| status          | enum `payout_job_status` | `queued`, `sending`, `sent`, `succeeded`, `failed`                   |
| tries           | integer                  | network or 5xx retries for this attempt                              |
| next_attempt_at | timestamptz              |                                                                      |
| paypal_batch_id | text null                |                                                                      |
| paypal_item_id  | text null                |                                                                      |
| last_error      | text null                | PayPal error name, never a body with personal data                   |
| updated_at      | timestamptz              |                                                                      |

Index: `(status, next_attempt_at)`.

### webhook_events

`id` text PK (PayPal event ID), `event_type`, `resource_id`, `verified` boolean, `payload` jsonb,
`received_at`, `processed_at` null, `error` null. Insert with `ON CONFLICT DO NOTHING`.

### decision_log

Append-only. `id` bigserial, `at`, `claim_id`, `actor_type` (`system`, `manager`, `judge`),
`actor_id` null, `action` (`decided`, `manager_decision`, `payout_sent`, `paid`, `payout_issue`,
`audit_requested`, `audit_resolved`), `data` jsonb (reason codes, amount, rules version).
Nothing updates or deletes these rows. Stretch: `prev_hash` and `hash` columns for a hash chain.

## Invariants

1. A claim has at most one `payout_jobs` row and at most one `reserve` ledger entry.
2. `amount_minor` is set if and only if the claim was approved at least once.
3. A claim in `paying` or `paid` has a `reserve` entry and a job with a `paypal_batch_id`.
4. A `release` entry exists only for a claim that ended `rejected` after a reservation.
5. `paid`, `rejected` and `expired` never change status again.
6. The available pool never goes below zero: the reservation and the check run in one
   transaction that locks the program's pool row (`SELECT ... FOR UPDATE` on `programs`).
7. Every status change writes a `decision_log` row in the same transaction.

Each invariant has a constraint where Postgres can express it, and a test in `packages/db`.

## As built (Nov 11, 2026)

Columns added to the tables above (migration `0000_init.sql`):

- `programs.config_hash`: SHA-256 of the validated program; a change bumps `version`.
- `claims.judge_session_id`: scopes duplicate search, claim rate and tiers for Judge claims.
- `claim_checks.reason`: the reason code a non-passing check contributes.
- `payout_jobs.receiver`, `payout_jobs.receiver_key` (the daily-cap key: email, or email plus judge
  session in Judge mode) and `payout_jobs.amount_minor` (check > 0).

Constraints and guards:

- Invariant 1: `payout_jobs` PK on `claim_id`; a partial unique index on `ledger_entries(claim_id, kind)`.
- Invariant 2: a check constraint ties approved-family statuses to a non-null `amount_minor`.
- `0001_guards.sql` (custom migration made with `drizzle-kit generate --custom`):
  - `decision_log` is append-only (trigger refuses UPDATE and DELETE);
  - invariant 5: a trigger refuses any status change out of `paid`, `rejected` or `expired`;
  - invariant 4: a `release` needs a matching `reserve` of the same amount.
- Invariant 6: the reservation runs in one transaction with `SELECT ... FOR UPDATE` on the program row.

Each has a test in `packages/db/test/invariants.test.ts`. Duplicate search for real claims also
compares against public sample photos (`photos.sample = true`).
