# Judge mode

Judges can't catch a fish. Judge mode lets them run scripted claims that exercise every real check,
pay real sandbox money, and then work the desk. It is on only when `JUDGE_MODE=true`.

## What is real and what is simulated

| Part                                    | In Judge mode                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Photo                                   | A sample photo from `samples/photos/`, chosen by the scenario                   |
| Location and capture time               | From the scenario                                                               |
| Species, length, quality, screen checks | Real Gemini call (cached per photo after the first run)                         |
| Code in frame                           | `skipped (sample photo)` unless the scenario photo contains its code; see below |
| Duplicate, area, season, rate, expiry   | Real, scoped to the judge session plus seeded history                           |
| Rules, budget guard, decision log       | Real                                                                            |
| Payout and webhook                      | Real PayPal sandbox payout to the sandbox personal account                      |
| Desk actions                            | Real                                                                            |

The UI labels every simulated part. Never hide it.

## Sessions

`POST /api/v1/judge/session` creates an ephemeral claimant `judge-<session>@bountyline.demo` whose
payouts go to `DEMO_CLAIMANT_PAYPAL_EMAIL`, or logs in as the demo manager. Duplicate search,
claim rate and reward tiers see only that session's claims plus the seeded history, so judges
never collide.

## Scenarios (`samples/scenarios.yaml`)

| ID                   | Expect       | What it shows                                                  |
| -------------------- | ------------ | -------------------------------------------------------------- |
| `clean-pikeminnow`   | approve, $6  | the full happy path and a payout                               |
| `clean-pikeminnow-2` | approve, $6  | a second fish; tiers count per claimant                        |
| `reused-photo`       | reject       | duplicate of the seeded paid claim from "last week"            |
| `out-of-area`        | hold         | a valid fish photographed in Seattle; the manager can clear it |
| `wrong-species`      | reject       | a look-alike claimed as pikeminnow                             |
| `undersized`         | reject       | declared 18 cm, below the 22.9 cm minimum                      |
| `pike-clean`         | approve, $10 | the second program: flat rate, Lake Roosevelt                  |

The seed script creates one paid claim from seven days ago using `pikeminnow-01.jpg`, so
`reused-photo` has something to match.

## Your own photos (recommended)

If you photograph a real fish with a handwritten code card, add `code: "K7-42"` (the code on the
card) to that scenario. Judge mode then issues exactly that code and the code check runs for real.
Use `programs/own-photos.template.yaml` for the species you photographed.

## Photo credits

Every sample photo has a row in `samples/CREDITS.md`: file, source URL, author, licence. Prefer US
federal works (usually public domain), then CC0 and CC BY. The README links the credits.

## Pool and quota

The seed funds each demo program with $5,000 of ledger money. In Judge mode, when a program's
available pool drops under $100, the service adds a `judge_top_up` funding entry. Vision results
for scenario photos are cached, so repeated runs cost no Gemini quota.
