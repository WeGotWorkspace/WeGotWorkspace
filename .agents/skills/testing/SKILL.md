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
| Apps done gate (local) | `pnpm test:apps-done-gate` — typecheck, contract, Storybook smoke, coverage. CI adds unit + jsdom via `APPS_DONE_GATE_FULL=1` |
| Agent docs (links + English-only) | `pnpm run check:agent-docs` |
| Apps UI ↔ OpenAPI contract | `pnpm --filter @wgw/apps run test:contract` |
| API PHPUnit (package) | `composer test` in `packages/api` |
| Apps Vitest (unit + jsdom) | `pnpm test` in `packages/apps` |
| Storybook Vitest smoke (`vitest-ci`) | `pnpm test:storybook:ci` in `packages/apps` |
| API e2e (Docker) | `pnpm test:api-e2e:docker` |
| Apps Playwright smoke (Storybook) | `pnpm test:apps-e2e` — CI job `apps-e2e` |
| Apps Playwright live | `pnpm --filter @wgw/apps test:e2e:live` — nightly `.github/workflows/nightly-live-e2e.yml`, not a pull-request check |

Handoff and PR verification: [developer/done-checklist.md](../developer/done-checklist.md). Issue acceptance criteria: [verify-issue](../verify-issue/SKILL.md). Policy vs CI: [.agents/POLICY.md](../../POLICY.md). Review gate: [code-review](../code-review/SKILL.md).

## Coverage ratchet

Per-package line coverage can only go up. The baseline lives in `tools/coverage-baseline.json`.

The `coverage-ratchet` job runs after `api-coverage` and `apps-coverage` whenever `coverage-scope` (`tools/coverage-scope.mjs`) asked for at least one side. A failed coverage job does not skip it: a missing report exits 3 and fails the ratchet job.

- **Push to `main`:** both sides. A drop opens or comments on a `coverage-regression` issue and fails the job; a rise uploads the `coverage-baseline-proposal` artifact.
- **Merge queue:** the side whose files changed (anything outside `packages/api/` and `packages/apps/`, except `.agents/` and `docs/`, runs both). A drop fails the job and lists it in the job summary; nothing is filed or uploaded. `build`, a required check, needs `coverage-ratchet`, so the drop blocks the merge. The coverage jobs run beside `api-mysql`, so the queue takes about as long as before.
- **Pull requests:** no coverage, unless labeled `run-full-ci` (the changed side, as in the queue) or `run-apps-coverage` (the apps side). The ratchet then checks only the side that ran (`check --only=api|apps`).

API coverage counts only `packages/api/app/Services/<Domain>`, from clover paths under `app/Services/`. Controllers, models, and the rest of `packages/api` are outside the ratchet.

The API suite runs with coverage in four `api-coverage-shard` jobs (`scripts/phpunit-shard.php`, each with `--coverage-php`). The `api-coverage` job then merges the shards into one clover file with `php scripts/merge-coverage.php <clover.xml> <shard.cov>...`.

`node tools/coverage-ratchet.mjs check` compares the reports to the baseline. `check --json` prints that report as JSON on stdout. `update` sets each existing key to `max(baseline, current)`, adds new keys, and drops keys that are gone. It does not record a drop, including a drop under the 0.5 point threshold. Run `update` after raising coverage, then commit the baseline.

`update --reseed` writes the current report as-is and drops keys the report does not contain. It prints each key that went down and each key that disappeared. It exists only to align the baseline with the first CI-measured report (the current apps baseline came from a local merge). It is not a way to accept a regression. A pull request that reseeds must say why and link the CI run whose artifacts it used.

**SPA front routes:** new top-level apps router paths need `UiStaticServer` allowlist + `FrontRoutingTest` coverage (Architecture `SpaShellRouteAllowlistTest`). That is API done-gate territory. Storybook-tier Playwright (`apps-e2e`) does not cover new SPA prefixes.

## Multitask

- Test **hardening / verify** chunks run after build chunks merge; red-green tests belong with or before build — see [developer/multitask.md](../developer/multitask.md).
- After parallel builds, spawn a verifier when [multitask-verifier.md](../developer/multitask-verifier.md) applies; parent runs full verification suite per [done-checklist](../developer/done-checklist.md).
- Do not mark plan todos complete until tests actually pass.

## API depth

PHPUnit architecture, `WgwDatabaseTestCase`, factories, and greenfield guard: [api/testing.md](../api/testing.md).

## UI depth

Vitest layout, hook testing, Storybook vs unit split: [ui-architecture.md](ui-architecture.md).
