# 0003: Payout outbox, sender-ID idempotency, self-verified webhooks, reconciler

Date: 2026-10-26. Status: accepted.

**Context.** Networks fail between "PayPal accepted the payout" and "we recorded it". Webhooks can
be lost, replayed or arrive out of order. Simulator events can't be verified by postback.

**Decision.** The approval transaction writes a `payout_jobs` row (the outbox). A dispatcher sends
it with `sender_batch_id` derived from the claim ID, which PayPal refuses to reuse for 30 days, so
retries can't double-pay. Webhooks are verified by self-verification (CRC32 of the raw body and
PayPal's cert from a `*.paypal.com` URL), stored by event ID, then applied through the state
machine. A reconciler polls PayPal for jobs that stay `sent` longer than 2 minutes.

**Consequences.** Exactly-once effect from at-least-once delivery. Slightly more code than calling
PayPal inline, and three tests that matter most in the repo: retry, replay and lost webhook.
