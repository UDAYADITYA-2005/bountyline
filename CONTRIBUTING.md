# Contributing

## Workflow

1. Branch from `main`.
2. Make the change with tests. Core rules, state transitions, money and PayPal mapping are test-first.
3. Run `pnpm verify` (lint, typecheck, tests). CI runs the same command.
4. Open a pull request with a [Conventional Commit](https://www.conventionalcommits.org/) title, such
   as `feat(api): add audit export`.

## Ground rules

- Money is an integer number of cents (`Money`). Convert to PayPal's decimal string only inside
  `packages/paypal`.
- Only the payout dispatcher calls PayPal Payouts. The checks package must never import the PayPal
  package; lint enforces this.
- `packages/core` stays pure: inject `Clock` and `Random` instead of using the system clock or
  `Math.random()`.
- Validate every boundary with zod: HTTP input, environment, YAML, model output, PayPal responses.
- A check that is missing, uncertain or unavailable must hold a claim, never approve it.
- Schema changes go through `pnpm db:generate`. Never edit a committed migration.
- Tests never call PayPal or Gemini. Use the fakes in `apps/api/test` and `packages/checks`.
- Sandbox only. Never commit `.env` files, keys or live PayPal hosts.
