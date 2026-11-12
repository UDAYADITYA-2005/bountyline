# 0007: Deviations made during the build and the review round

Date: 2026-11-11. Status: accepted.

**Context.** A payments, security and code review of the first complete build found blockers. These
are the decisions that changed a spec as a result, with the reason.

**Decisions.**

1. **HELD stays `paying`.** `docs/PAYPAL.md` keeps a PayPal-held item in `paying`; the money rule file
   listed it under `payout_issue`. A held item can still pay, so moving it to `payout_issue` would let a
   manager retry with `-r1` and pay twice. The job shows `HELD_BY_PAYPAL`.
2. **Two extra state arrows:** `approved --paid--> paid` (a webhook can land before the dispatcher
   records `paying`) and `payout_issue --paid--> paid` (an UNCLAIMED item later claimed). PayPal saying
   money moved always wins; final states still never move.
3. **UNCLAIMED blocks desk action.** While a payout is UNCLAIMED, the desk refuses both retry and
   reject (409): the original item can still be claimed for 30 days. After RETURNED the manager may act.
4. **Stale attempts are ignored.** `sender_item_id` is the claim ID on every attempt, so an event or
   poll is applied only when its batch matches the job's current batch; events never re-point a retry.
5. **Judge mode deployments hold demo data only.** Anyone can open a Judge manager session, so with
   `JUDGE_MODE=true` registration and claimant password logins are closed. Judge claimants can still
   use the real capture flow.
6. **Receiver cap.** Rolling 24 hours, keyed by receiver email; in Judge mode by email plus judge
   session, because every judge pays the same sandbox account.
7. **Placeholder visual design.** Screens use a placeholder token set in
   `apps/web/src/styles/tokens.css`; a design pass changes tokens, not components.
8. **No HEIF uploads.** Capture produces JPEG; fewer decoders on untrusted input.

**Consequences.** More refusals on the desk in rare PayPal states, in exchange for no double payout.
The real claimant flow on a Judge deployment needs a Judge claimant session, not an account.
