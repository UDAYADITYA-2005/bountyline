# Product: Bountyline

**One line:** wildlife bounty claims checked by AI and paid by PayPal in minutes.
**Close line for the video:** "Bountyline. Prove it, get paid."

## Problem

Governments, tribes and agencies pay people to remove animals that damage ecosystems: invasive
species, and native predators managed to protect other species. Claiming the money is slow and
easy to cheat.

- Washington's Northern Pikeminnow Sport-Reward Fishery pays $6 to $10 per fish by cumulative
  count, and $500 for a specially tagged fish. Northern pikeminnow are a native predator of
  juvenile salmon; anglers hand in fresh fish at registration stations.
- The Colville Tribes pay $10 per northern pike head from Lake Roosevelt, where pike threaten
  native fish. Anglers bring heads to drop-off sites.
- Utah pays $50 for a coyote (more in mule-deer habitat) but still wants the jaw at a check-in and
  mails checks weeks later. In 2018 it found claims for coyotes that may have come from other
  states.
- Victoria pays $14 per fox scalp, handed in at set centres in two-hour windows.

Pitch these as "wildlife bounty programs: invasive species and predator control". Never call
pikeminnow or coyotes invasive.

## Users

- **Claimant** (angler, hunter, trapper): starts a claim, photographs the animal with a one-time
  code card in the frame, and is paid to their PayPal email.
- **Program manager** (agency, tribe, council, angling club): sets the rules in a program file,
  clears held claims, orders hand-in audits and watches the pool, on the desk.
- **Judge** (hackathon): runs scripted scenarios in Judge mode, as a claimant and as a manager,
  with sample photos and simulated locations.

## Minimum demoable product

1. A claimant starts a claim and sees a one-time code such as `K7-42`.
2. They submit a photo (in Judge mode, a scenario photo) with location and time.
3. Checks run in parallel and light up live: species, length, code in frame, area, season, photo
   reuse, claim rate.
4. The rules approve the claim. PayPal Payouts sends the tier amount to the claimant's sandbox
   email; a webhook marks it paid.
5. A reused photo is rejected with a reason. An out-of-area claim is held for the desk.
6. On the desk, a manager clears the held claim, which then pays; a random paid claim is flagged
   for a hand-in audit.

## Demo programs

| File                                | Modeled on                                        | Rule highlights                                                                                                                          |
| ----------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/columbia-pikeminnow.yaml` | WDFW/BPA Northern Pikeminnow Sport-Reward Fishery | Tiers $6 (fish 1 to 25), $8 (26 to 200), $10 (201+); minimum 22.9 cm (9 in); demo season Oct 2026 to Jan 2027 so judging falls inside it |
| `programs/lake-roosevelt-pike.yaml` | Colville Tribes Northern Pike Reward              | $10 flat per fish, no size limit, claimant 17 or older                                                                                   |
| `programs/own-photos.template.yaml` | Your own photos                                   | Copy it if you photograph a market fish with code cards                                                                                  |

Both demo programs say "demo" in their names and link the real program. Program boundaries are
simplified polygons, not official boundaries.

## Photos

The builder can't film a real pikeminnow or pike, so Judge mode uses sample photos: US government
photos (usually public domain) or openly licensed ones, each logged in `samples/CREDITS.md`. Sample
photos can't contain a fresh one-time code, so for them the code check reports `skipped (sample
photo)`. Everything else runs for real. Taking your own photos of any whole fish with printed code
cards restores the real code check; see `programs/own-photos.template.yaml`.

## Non-goals

- Native mobile apps. The claimant app is a phone-friendly web app.
- Real agency integrations, tax forms or identity verification.
- Admin screens for creating programs. Programs are YAML files loaded at boot.
- Training a model. We use a hosted vision model.
- Running the physical audit. The desk only flags which claims need the animal handed in.
- Live PayPal. Everything runs in the PayPal sandbox.

## Stretch, only after Gate 2 passes on time

1. AG Studio Agent Framework on the desk, using Gemini through our backend, with read-only tools.
2. Funding the pool through PayPal Checkout (Orders v2), so money flows in as well as out.
3. A tamper-evident hash chain over the decision log, shown on the desk.

## What judges should leave with

- The agent decides each claim end to end without a human, but the model can't move money.
- Money moves within a minute of a clean claim, and fraud attempts are caught with reasons.
- The repo runs first time, names every PayPal call and AI model with file paths, and is MIT
  licensed.
