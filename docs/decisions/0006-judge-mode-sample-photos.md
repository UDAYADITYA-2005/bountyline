# 0006: Judge mode with sample photos and simulated capture

Date: 2026-10-26. Status: accepted, with a recommended upgrade.

**Context.** The builder can't film or photograph a northern pikeminnow or pike. Judges can't
either. Sample photos can't contain a fresh one-time code.

**Decision.** Judge mode runs scripted scenarios: a sample photo, a simulated location and capture
time, and the real checks, rules, payout and webhook. For sample photos the code check reports
`skipped (sample photo)`, and the UI says so. Judge claims are scoped to a judge session.

**Recommended upgrade.** Photograph any whole fish with handwritten code cards on a ruler, add a
program for that species from the template, and set `code` on those scenarios. The code check then
runs for real.

**Consequences.** Every judge can test the full money path without a fish. The code check is the
one feature shown by explanation rather than live, unless the upgrade is done.
