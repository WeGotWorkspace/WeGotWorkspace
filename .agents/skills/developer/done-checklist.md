# Done checklist

Run before declaring work complete or opening a PR (when the user asks). Policy context: [.agents/POLICY.md](../../POLICY.md).

**Primary verify method:** call MCP tools via **wgw-verify** when available ([mcp-verification.md](mcp-verification.md)) — `run_apps_done_gate`, `run_api_done_gate`, `run_ci_quality`. Bash commands below are equivalent fallbacks.

## When work tracks a GitHub issue

If the task references an issue (`#N`, issue URL, or "fixes #N"):

1. Load [verify-issue](../verify-issue/SKILL.md) — detect Goal vs Task/Epic mode; fetch issue; map acceptance criteria (or success signals + children for Goals); run per-criterion checks; report verdict. Never treat a Goal as sole `fixes #` / `Source:` for `feat/` work.
2. Then run the package sections below (repo quality gate).

Issue AC verification and done-checklist are both required; neither replaces the other.

## Always (any touched package)

- [ ] Changes match the relevant domain skill (`api`, `apps-ui`, `workspace`, `meet`, …)
- [ ] No unrelated refactors or markdown the user did not ask for
- [ ] [clean-code/smells.md](../clean-code/smells.md) scan on touched files
- [ ] **English-only** — specs, plans, docs, and any GitHub issue/PR text you wrote are English even if the user prompt was Dutch ([english-only.md](english-only.md)). `pnpm run check:agent-docs` (also part of `ci:quality:apps`)
- [ ] `git status` clean for intended scope (no accidental `.env`, secrets, debug logs)

## API (`packages/api`)

MCP: `run_api_done_gate` · Bash fallback:

```bash
cd packages/api && composer test -- --filter <Domain>   # domain you changed
pnpm test:api-done-gate                                 # from repo root, before merge-ready API work
```

- [ ] OpenAPI updated if HTTP contract changed (`packages/api/openapi/openapi.json`)
- [ ] Feature tests assert status + JSON shape ([testing/test-first.md](../testing/test-first.md))
- [ ] `composer greenfield:guard` passes
- [ ] Typegen if contract changed: `pnpm --filter @wgw/api run openapi:build-json` + apps typegen
- [ ] New top-level SPA client routes: prefix on `UiStaticServer` + `FrontRoutingTest` ([api/SKILL.md](../api/SKILL.md))

Optional local: `pnpm test:api-e2e:docker`, `pnpm test:meet-api` (meet signaling).

## UI (`packages/apps`)

MCP: `run_apps_done_gate` · Bash fallback:

```bash
pnpm test:apps-done-gate                 # typecheck + Vitest + Storybook smoke + coverage
pnpm --dir packages/apps test              # Vitest only
pnpm dev:ui                              # Storybook — mock-tier stories for changed exports
```

- [ ] New/changed **exports** have **mock-tier** stories ([storybook/offline-first.md](../storybook/offline-first.md))
- [ ] `pnpm check:storybook-coverage` passes (no new baseline gaps)
- [ ] Stories run without Docker/API (`pnpm dev:ui` only)
- [ ] Slice handlers / mock `operations` — no `@/lib/api/wgw/http` in panes ([apps-ui/components.md](../apps-ui/components.md))
- [ ] Storybook a11y panel on new/changed stories ([storybook/a11y-testing.md](../storybook/a11y-testing.md))
- [ ] Vitest for new/changed hooks, parsers, RTC/session logic ([testing/ui-architecture.md](../testing/ui-architecture.md))
- [ ] New/changed hook files: [clean-code/smells.md](../clean-code/smells.md) React hooks section — split if over limits, or link a refactor issue with explicit user approval; collab hooks follow [collab-hooks.md](../workspace/collab-hooks.md)
- [ ] New top-level route in `wegotworkspace-routes.tsx`: also update API `UiStaticServer` allowlist (apps done gate does **not** cover this — Architecture + FrontRouting on API side)

Meet/RTC: `pnpm --dir packages/apps exec vitest run src/lib/rtc/session src/meet-core/src/meet-rtc-session.test.ts`

## Full-stack feature

- [ ] API checklist + UI checklist
- [ ] OpenAPI/typegen before UI consumers if contract changed
- [ ] After parallel agent chunks: verifier report when required ([multitask-verifier.md](multitask-verifier.md)); parent runs full verify ([multitask.md](multitask.md))

## Before push (`packages/apps` UI work)

Husky **pre-push** runs `pnpm test:apps-done-gate` when any file under `packages/apps/` changed in commits being pushed (vs the remote tip). Run it yourself before push if hooks are skipped — incremental commits on a branch are expected to fail an intermediate SHA; the gate must pass at **push time** so CI does not catch merge blockers first.

```bash
pnpm test:apps-done-gate                 # apps UI exports, panes, hooks, stories
```

- [ ] Done gate green before `git push` when `packages/apps/**` changed
- [ ] Targeted Vitest alone is not enough for merge-ready apps UI work ([testing/apps-done-gate.md](../testing/apps-done-gate.md))

## Before PR (when user requests push/PR)

MCP: `run_ci_quality` · Bash fallback:

```bash
pnpm run ci:quality
```

- [ ] Signed commits ([git-workflow/pull-requests.md](../git-workflow/pull-requests.md))
- [ ] PR test plan lists concrete commands run ([testing/SKILL.md](../testing/SKILL.md))
- [ ] CI validates **PR tip (branch HEAD)** only — intermediate commits may be red until fix-forward; do not require per-commit gates in CI ([#250](https://github.com/WeGotWorkspace/wegotworkspace/issues/250))

## Dev environment issues

If verification commands fail unexpectedly, see [dev-environment/SKILL.md](../dev-environment/SKILL.md).
