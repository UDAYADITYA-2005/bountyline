# 0002: The model proposes, the rules decide, one worker pays

Date: 2026-10-26. Status: accepted.

**Context.** The brief rewards "AI behind the wheel", and PayPal's engineers will ask what stops the
model from paying the wrong person. Vision models misread, and text in a photo can try to steer
them.

**Decision.** Gemini returns observations in a fixed schema and never sees the expected code or
the declared species. Plain functions turn observations into check results. A pure rules engine in
`packages/core` decides approve, hold or reject from the check results and the program file. Only
the payout dispatcher calls PayPal, and only for jobs written in the same transaction as an
approval. `packages/checks` can't import `packages/paypal`.

**Consequences.** The agent still runs each claim end to end with no human for clean claims. Every
decision is explainable by reason codes and reproducible from stored check results and the program
version. Accuracy problems become holds, not wrong payments.
