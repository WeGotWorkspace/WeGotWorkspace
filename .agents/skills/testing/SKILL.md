---
name: testing
description: Testing workflow for the WeGotWorkspace monorepo — test-first order, API PHPUnit, apps Vitest, e2e, done-gate, and done-when checklists. Use when writing, running, or reviewing tests.
paths:
  - "packages/api/tests/**"
  - "packages/apps/**/*.test.ts"
  - "packages/apps/**/*.test.tsx"
  - "**/*e2e*"
---

# Testing

## Quick decision matrix

| Task | Read |
|------|------|
| Test-first / red-green order | [test-first.md](test-first.md) |
| API / PHPUnit / done gate | [api/testing.md](../api/testing.md) |
| Apps UI done gate | [apps-done-gate.md](apps-done-gate.md) |
| UI unit tests / Vitest | [ui-architecture.md](ui-architecture.md) |
| Storybook visual states | [storybook](../storybook/SKILL.md) |
| Offline UI catalog (no API) | [storybook/offline-first.md](../storybook/offline-first.md) |
| Code quality (F.I.R.S.T.) | [clean-code](../clean-code/SKILL.md) |

## Commands

| Scope | Command |
|-------|---------|
| API done gate | `pnpm test:api-done-gate` or `composer done-gate` in `packages/api` |
| Apps done gate | `pnpm test:apps-done-gate` or `pnpm run test:done-gate` in `packages/apps` |
| Apps UI ↔ OpenAPI contract | `pnpm --filter @wgw/apps run test:contract` |
| API PHPUnit (package) | `composer test` in `packages/api` |
| Apps Vitest (unit + jsdom) | `pnpm test` in `packages/apps` |
| Storybook Vitest smoke (`vitest-ci`) | `pnpm test:storybook:ci` in `packages/apps` |
| API e2e (Docker) | `pnpm test:api-e2e:docker` |
| Apps Playwright smoke (Storybook) | `pnpm test:apps-e2e` |

Handoff and PR verification: [developer/done-checklist.md](../developer/done-checklist.md). Issue acceptance criteria: [verify-issue](../verify-issue/SKILL.md). Policy vs CI: [.agents/POLICY.md](../../POLICY.md). Review gate: [code-review](../code-review/SKILL.md).

**SPA front routes:** new top-level apps router paths need `UiStaticServer` allowlist + `FrontRoutingTest` coverage (Architecture `SpaShellRouteAllowlistTest`). That is API done-gate territory — not Playwright e2e (still out of scope in POLICY).

## Multitask

- Test **hardening / verify** chunks run after build chunks merge; red-green tests belong with or before build — see [developer/multitask.md](../developer/multitask.md).
- After parallel builds, spawn a verifier when [multitask-verifier.md](../developer/multitask-verifier.md) applies; parent runs full verification suite per [done-checklist](../developer/done-checklist.md).
- Do not mark plan todos complete until tests actually pass.

## API depth

PHPUnit architecture, `WgwDatabaseTestCase`, factories, and greenfield guard: [api/testing.md](../api/testing.md).

## UI depth

Vitest layout, hook testing, Storybook vs unit split: [ui-architecture.md](ui-architecture.md).
