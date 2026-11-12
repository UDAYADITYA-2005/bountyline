# Security

Threats a hackathon judge, a fraudster or a careless agent could raise, and the control for each.
Check this table against the code before every release.

| Threat                                             | Control                                                                                                                                      | Where                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Old or someone else's photo                        | One-time code in the frame; camera-only capture; duplicate search on pHash and SHA-256; random hand-in audits                                | `packages/checks`, `apps/web` capture, desk          |
| Same fish claimed twice                            | Duplicate search across all claims in scope; claim-rate hold; audits                                                                         | `packages/checks`                                    |
| Photo of a screen or a print, or a generated image | `screen_suspected` check holds; audits. Honest limit: a careful fake can pass, which is why audits exist                                     | vision prompt, rules                                 |
| Text in the photo trying to instruct the model     | Prompt treats image text as evidence; schema-only output; no tools; the rules engine ignores free text                                       | `packages/checks`                                    |
| GPS spoofing                                       | Accuracy threshold; outside-area holds; audits. Honest limit: browser location can be spoofed                                                | rules, desk                                          |
| Many accounts, one PayPal receiver                 | Daily payout cap keyed by receiver email, not by account                                                                                     | budget guard                                         |
| Paying twice                                       | One job per claim; `sender_batch_id` from the claim ID; webhook stored by event ID; state machine refuses backwards moves                    | `packages/core`, `apps/api/src/jobs`, DB constraints |
| Paying without a decision                          | Only the dispatcher calls Payouts, only for jobs created in the approve transaction                                                          | ADR 0002                                             |
| Forged webhook                                     | Self-verified signature; cert host must end in `.paypal.com`; webhook ID must match                                                          | webhook route                                        |
| SSRF through the cert URL                          | https only, host allowlist, 5 s timeout, cached by URL                                                                                       | `packages/paypal`                                    |
| Session theft or CSRF                              | httpOnly, Secure, SameSite=Lax cookie; `Origin` check on unsafe methods; sessions expire after 7 days                                        | `apps/api`                                           |
| Reading someone else's claim or photo              | Ownership check in the service, plus route-level role; tests for both                                                                        | `apps/api/src/services`                              |
| Malicious upload                                   | 8 MB limit; sharp decode and re-encode to JPEG; metadata stripped; type by content                                                           | photo ingest                                         |
| Brute force and spam                               | Rate limits: login 5/min/IP, register 3/hour/IP, claim start 10/hour/user, evidence 20/hour/user, Judge runs 30/hour/session                 | `@fastify/rate-limit`                                |
| Secret leakage                                     | Secrets only in env; pino redaction (`req.headers.authorization`, `*.secret`, `*.token`, `*.password`, `*.email`)                            | config, logger                                       |
| Live money by accident                             | `PAYPAL_ENV` must be `sandbox` or boot fails; the PayPal client refuses any non-sandbox base URL                                             | config, `packages/paypal`                            |
| Judge mode abuse                                   | Off unless `JUDGE_MODE=true`; runs scoped to the judge session; cached vision results; rate limits; automatic pool top-up only in Judge mode | `apps/api`                                           |
| Location privacy                                   | Exact location only on the desk; the claimant's own view and logs round to 3 decimals; EXIF stripped                                         | API, logger                                          |

## Configuration rules

- `SESSION_SECRET` is at least 32 random bytes; Render generates it.
- CORS is off: the web app is served from the same origin as the API.
- Security headers via `@fastify/helmet`, with a CSP that allows the app's own origin, Gemini is
  server-side only, and AG Studio's needs (check its docs for required `style-src` allowances).
- Dependencies: run `pnpm audit --prod` at the freeze; fix high and critical issues.
