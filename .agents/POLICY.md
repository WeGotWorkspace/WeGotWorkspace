# Agent policy vs enforcement

Policies agents should follow for **new work**. Backlog gaps are tracked on GitHub — do not treat “policy only” rows as optional for code you add today.

| Policy | New work | Enforced how | Tracking |
|--------|----------|--------------|----------|
| **API greenfield** | Reimplement from OpenAPI; no legacy PHP | `composer greenfield:guard`, architecture tests, done gate | [api/SKILL.md](skills/api/SKILL.md) |
| **OpenAPI → failing feature test → implement** | Required for new REST behavior | CI: `pnpm test:api-done-gate` (feature suites) | [testing/test-first.md](skills/testing/test-first.md) |
| **Operations DI** (App → operations → controller → pane) | Required in touched UI | Review + incremental refactor | [apps-ui/components.md](skills/apps-ui/components.md) — product verticals done in [#77](https://github.com/WeGotWorkspace/wegotworkspace/pull/77) |
| **Mock-tier Storybook** for every new export | Required | CI: `pnpm check:storybook-coverage` (baseline — no new gaps) | [storybook/offline-first.md](skills/storybook/offline-first.md) — audit closed in [#72](https://github.com/WeGotWorkspace/wegotworkspace/issues/72) / [#76](https://github.com/WeGotWorkspace/wegotworkspace/pull/76) |
| **Live-tier stories** (`Live …`) | Optional smoke only; never sole coverage | Manual | [storybook/offline-first.md](skills/storybook/offline-first.md) |
| **Story `play` functions** | Target for critical UI flows | CI via `vitest-ci` smoke stories | [testing/apps-done-gate.md](skills/testing/apps-done-gate.md) |
| **`@storybook/addon-vitest`** | Target | CI: Storybook smoke via `pnpm test:apps-done-gate` inside `ci:quality`; full catalog locally via `test:storybook` | [storybook/offline-first.md](skills/storybook/offline-first.md) — wired in [#74](https://github.com/WeGotWorkspace/wegotworkspace/pull/74) |
| **Apps done gate** | Run before merge-ready UI work | Husky **pre-push** runs the **local** gate when `packages/apps/**` changed (typecheck, OpenAPI contract, Storybook smoke, coverage). **CI** `apps-quality` sets `APPS_DONE_GATE_FULL=1` and also runs Vitest unit + jsdom | [testing/apps-done-gate.md](skills/testing/apps-done-gate.md) |
| **Vitest for hooks / pure logic** | Required when adding non-trivial logic | CI `apps-quality` (`APPS_DONE_GATE_FULL=1`): unit project plus jsdom shards in a pool sized for GitHub-hosted runners | [testing/ui-architecture.md](skills/testing/ui-architecture.md) |
| **UI pane RTL tests** | Encouraged for interaction-heavy panes | jsdom project (`*.test.tsx`) | [testing/ui-architecture.md](skills/testing/ui-architecture.md) |
| **UI e2e (Playwright apps)** | Out of scope | — | — |
| **SPA front routes ↔ UiStaticServer allowlist** | Required when adding a top-level apps router path (e.g. `/share`, `/tasks`) | Architecture: `SpaShellRouteAllowlistTest` + `FrontRoutingTest` inside `pnpm test:api-done-gate` | [api/SKILL.md](skills/api/SKILL.md) — Playwright e2e still out of scope; this contract is the substitute |
| **WCAG 2.2 AA** | Required for new/changed UI | CI: a11y `error` on `vitest-ci` smoke (`STORYBOOK_A11Y_GATE=1`); manual `todo` in dev | [storybook/a11y-testing.md](skills/storybook/a11y-testing.md) |
| **Chromatic** | Optional visual regression ([#85](https://github.com/WeGotWorkspace/wegotworkspace/issues/85)); enable with repo variable | Dedicated `chromatic` job when `CHROMATIC_ENABLED=true` + `CHROMATIC_PROJECT_TOKEN`; unaccepted diffs are published for review and do **not** fail CI (`exitZeroOnChanges: true`); `main` auto-accepts baselines; Live stories excluded | [storybook/chromatic.md](skills/storybook/chromatic.md), [testing/apps-done-gate.md](skills/testing/apps-done-gate.md) |
| **No auto-commits / PRs** | Always | User instruction | [git-workflow/SKILL.md](skills/git-workflow/SKILL.md) |
| **Draft pull requests** | Every PR opens as a draft; mark ready only when the user asks to enqueue | Cursor hook rejects `gh pr create` without `--draft` | [git-workflow/pull-requests.md](skills/git-workflow/pull-requests.md) |
| **Merge queue on `main`** | Land by enqueueing a merge commit; the queue rechecks against current `main` | Branch ruleset once `merge_group` CI is on `main` | [git-workflow/pull-requests.md](skills/git-workflow/pull-requests.md) |
| **Signed commits on `main`** | Required for merge | Branch protection | [git-workflow/pull-requests.md](skills/git-workflow/pull-requests.md) |
| **Agent verification** | Run done gates before handoff | MCP `wgw-verify` tools (`run_*_done_gate`, `run_ci_quality`); bash fallback | [developer/mcp-verification.md](skills/developer/mcp-verification.md) |
| **English-only artifacts** | Specs, plans, docs, GitHub issues/Goals/comments, PRs — English even if the user writes Dutch | CI: `pnpm run check:agent-docs` (prose scan); review + this policy for GitHub text CI cannot see | [developer/english-only.md](skills/developer/english-only.md) |
| **Product intent** | User outcomes live in Goal issues (`type:goal`) on the [Product Project](https://github.com/orgs/WeGotWorkspace/projects/1) (start at [0.9 Roadmap](https://github.com/orgs/WeGotWorkspace/projects/1/views/4)); [docs/product/](../docs/product/) is process only. `feat/` `Source:` / `fixes #` is Task/Epic only (never Goal alone) | Review + [verify-issue](skills/verify-issue/SKILL.md) Goal vs Task modes | [GOVERNANCE.md](../GOVERNANCE.md), [issue-filing.md](skills/developer/issue-filing.md), [specs/README.md](specs/README.md) |

**Domain skills override** generic rows when more specific ([clean-code](skills/clean-code/SKILL.md), [api/layers.md](skills/api/layers.md), etc.).

Before handoff, run [developer/done-checklist.md](skills/developer/done-checklist.md).

## Enforcement layers (agent → pre-commit → pre-push → CI)

| Layer | When | What runs | Scope |
|-------|------|-----------|--------|
| **MCP** (`wgw-verify`) | During development / handoff | `run_apps_done_gate`, `run_api_done_gate`, `run_ci_quality`, quick checks | Callable by any MCP-enabled agent — wraps same scripts as bash |
| **pre-commit** (Husky) | Every commit | lint-staged: Prettier + ESLint on staged `@wgw/apps`; Pint on staged API PHP | Staged files only |
| **pre-push** (Husky) | Every push | Local apps done gate when `packages/apps/**` changed (no unit/jsdom Vitest); else `@wgw/apps` typecheck | Commits being pushed vs remote tip |
| **CI** (`apps-quality`, `api-quality`) | PR / push to `main` | `pnpm run ci:quality:apps` / `ci:quality:api` on **checkout HEAD**. Apps job sets `APPS_DONE_GATE_FULL=1` (unit + pooled jsdom) | Branch tip only — not every commit in PR history |

**CI validates the PR tip only.** Intermediate commits on a feature branch may fail the full done gate until a later fix-forward commit; that is expected. Do not add per-commit CI gates. Retroactive `pnpm test:apps-done-gate` at old SHAs is for bisect/debug, not merge blocking.

**Apps UI new work:** the local done gate must pass before push (hook). CI on HEAD also runs Vitest unit and jsdom. See [testing/apps-done-gate.md](skills/testing/apps-done-gate.md) and [git-workflow/SKILL.md](skills/git-workflow/SKILL.md).
