# 0005: Check runner with an inline fallback and Render Workflows in production

Date: 2026-10-26. Status: accepted.

**Context.** Render Workflows runs tasks on their own instances and fans out subtasks in parallel,
which fits checks and earns the Render story. It adds a deploy unit, an API key, and per-run start
latency that we haven't measured.

**Decision.** A `CheckRunner` port with two adapters. `InlineCheckRunner` runs
`runClaimChecks(claimId)` in the API process (local, tests, fallback). `RenderWorkflowsCheckRunner`
starts `bountyline-checks/runClaimChecks` with `@renderinc/sdk` and falls back to inline if the
start fails. Both write results through the same service, so the decision code is shared.

**Consequences.** The demo never depends on Workflows being up. Measure end-to-end latency at
Gate 2; if Workflows adds more than 10 seconds to a claim, keep it for the desk's batch re-checks
and use inline for live claims, and record that here.
