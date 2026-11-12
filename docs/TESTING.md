# Testing

Fast tests on every edit, real Postgres semantics without Docker, and no live calls except in two
explicit commands.

## Layers

| Layer             | Tool                                   | What it covers                                                                                                                                             | Runs                 |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Unit              | Vitest                                 | `core` (money, tiers, rules, transitions, budget guard, audit sampling), check functions, PayPal request building and webhook verification, config parsing | every commit, CI     |
| Integration       | Vitest + PGlite + `buildApp()` + fakes | API routes end to end: auth, claims, evidence, desk decisions, webhook route, dispatcher and reconciler with `FakePayoutGateway`                           | every commit, CI     |
| Contract fixtures | recorded JSON                          | PayPal create/read payout responses, webhook events signed with a test cert, Gemini responses for each scenario photo                                      | in integration tests |
| Eval              | `pnpm eval:checks`                     | Real Gemini on the scenario pack; Gate 2                                                                                                                   | by hand, asks first  |
| Smoke             | `pnpm paypal:smoke`, manual checklist  | One real sandbox payout; the deployed app                                                                                                                  | Gate 1, freeze       |
| E2E (optional)    | Playwright                             | Judge mode: run the clean scenario, see "Paid"                                                                                                             | freeze, if time      |

## Must-have tests

- Money: `toPayPalValue` for 0, 1, 99, 100, 600, 50000 cents; no float paths.
- Tiers: fish 1, 25, 26, 200, 201 for the pikeminnow program; flat $10 for pike.
- Rules: one table row per reason code, plus combinations (a reject reason beats a hold reason).
- Transitions: every legal move, and a test that each illegal move throws `INVALID_STATE`.
- Budget guard: exact balance, one cent short, receiver daily cap.
- Dispatcher: success; 5xx then success (same `sender_batch_id`); duplicate-batch error; 4xx;
  crash while `sending`.
- Webhook: valid signature; tampered body; wrong cert host; wrong webhook ID; replay; out-of-order
  `SUCCEEDED` after `FAILED`; unknown event type.
- Reconciler: a lost webhook resolved by polling.
- Checks: geofence inside and outside both demo polygons; season edges in the program time zone;
  pHash distances 0, 6, 7, 12, 13; code normalisation; quota exhausted gives `unavailable`.
- Authz: a claimant can't read another claimant's claim or photo; a claimant can't call desk
  routes; Judge routes 404 when `JUDGE_MODE` is off.

## Helpers (in `test/` folders)

- `createTestDb()`: a fresh PGlite with migrations applied.
- `FixedClock`, `SeededRandom`.
- `FakePayoutGateway`: scripted responses per call; records requests.
- `FakeVisionProvider`: returns recorded findings by photo SHA-256.
- `signWebhook(event, { certHost })`: signs a fixture with the test cert.
- `makeClaim()`, `makeProgram()` builders.

## CI

`.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` and `pnpm verify` on every push
and pull request. Red CI on `main` blocks the next step.
