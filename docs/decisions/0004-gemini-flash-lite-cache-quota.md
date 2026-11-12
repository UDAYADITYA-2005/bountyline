# 0004: Gemini Flash-Lite by default, cached by photo, with a quota guard

Date: 2026-10-26. Status: accepted.

**Context.** The builder has Gemini access. Developer forum reports put the free tier at about 20
requests a day for Gemini 3.8 Flash and about 500 for Flash-Lite, per project. Free-tier prompts
are used to improve Google's products.

**Decision.** Default `GEMINI_MODEL=gemini-3.5-flash-lite`, one call per photo, results cached by
`(sha256, model, prompt version)`. A daily counter stops calls at `GEMINI_DAILY_REQUEST_LIMIT`
(450) and holds claims instead. Tests never call Gemini. The eval harness can switch models and
bypass the cache.

**Consequences.** Judge mode costs no quota after warm-up. Development and Gate 2 fit in the free
tier. If accuracy falls short, switch the eval to `gemini-3.8-flash` with billing on, and record
the change here.
