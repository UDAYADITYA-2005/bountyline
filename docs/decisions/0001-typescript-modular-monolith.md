# 0001: TypeScript modular monolith in a pnpm workspace

Date: 2026-10-26. Status: accepted.

**Context.** One builder, 17 days. AG Studio, the PayPal
server SDK and the Render Workflows SDK all have first-class TypeScript support.

**Decision.** One pnpm workspace: `apps/api` (Fastify), `apps/web` (React + Vite),
`apps/workflows` (Render Workflows tasks), and packages `contracts`, `core`, `config`, `db`,
`paypal`, `checks`. The API serves the web build from the same origin. An ESLint import rule
enforces the dependency table in ARCHITECTURE.md.

**Consequences.** One language and one type system end to end; shared zod contracts between web
and api; one deploy unit for the web tier. Package boundaries keep the domain testable without
microservices. Python image libraries are not available; sharp covers what we need.
