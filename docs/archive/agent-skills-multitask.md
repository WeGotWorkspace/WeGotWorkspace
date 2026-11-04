# Agent skills multitask restructure

> **Archived 2026-11-04.** The `.agents/skills/` stack this plan describes is on main since 2026-06. The plan is kept for history and is not a current plan.

Archived plan from branch `chore/agent-skills-multitask` (2026). Use as a reference when planning similar doc/skill work.

## Goal

Replace prefixed agent skills with a tool-agnostic `.agents/skills/` stack that routes multitask agents to domain skills, honest policy docs, and verification checklists — without restoring legacy API PHP.

## Non-goals

- Cursor-only `.cursor/agents/` subagents
- Full operations DI refactors in product code (tracked separately in #66–#71)
- 100% Storybook export coverage in one pass (baseline + CI regression guard instead)

## Affected packages

- `.agents/skills/`, `AGENTS.md`, `.agents/README.md`, `.agents/POLICY.md`
- `docs/plans/` (this archive)
- `packages/apps` — Storybook coverage script, Vitest addon wiring
- `.github/workflows/ci.yml`, root `package.json` — link checker + coverage CI

## Dependencies

1. Rename unprefixed skills + workflow skills (`plan-feature`, `testing`, `document`, …)
2. P0 audit fixes (slim `AGENTS.md`, multitask/test-first alignment, issue links)
3. P1 policy/done-checklist/meet/dev-environment skills
4. P2 CI enforcement (coverage baseline, link checker, addon-vitest)

## Chunks (as executed)

### Chunk A: Skill restructure

- **Skill:** developer, document
- **Done when:** Unprefixed skill dirs; `AGENTS.md` index; `developer/multitask.md`
- **Verify with:** Read-through; no broken skill paths

### Chunk B: Domain + workflow depth

- **Skill:** api, apps-ui, workspace, storybook, testing, git-workflow
- **Parallel with:** A (different files)
- **Done when:** `offline-first.md`, `test-first.md`, `components.md` operations DI, git PR/branch docs
- **Verify with:** Cross-link grep

### Chunk C: P0 routing fixes

- **Skill:** developer, api, testing, storybook, apps-ui
- **Done when:** Slim bootstrap; red-green multitask wording; #66–#72 links; meet in api matrix
- **Verify with:** `git diff AGENTS.md`

### Chunk D: P1 policy layer

- **Skill:** developer, plan-feature, meet, dev-environment
- **Done when:** `POLICY.md`, `done-checklist.md`, deduped plan-feature/coverage
- **Verify with:** Link checker (added in P2)

### Chunk E: P2 CI truthfulness

- **Skill:** storybook, testing, developer
- **Done when:** `check-storybook-coverage.mjs` + baseline; `@storybook/addon-vitest` wired; `check:agent-docs` in CI
- **Verify with:** `pnpm run check:agent-docs`, `pnpm run check:storybook-coverage`, `pnpm --filter @wgw/apps run test:storybook:ci`

## Test plan

- [x] API done gate unchanged (`pnpm test:api-done-gate`)
- [x] Apps unit tests (`pnpm --filter @wgw/apps test`)
- [x] Storybook Vitest smoke project in CI (P2)
- [x] Coverage baseline prevents new export gaps without stories

## Tracking issues

| Issue | Topic |
|-------|--------|
| [#66](https://github.com/WeGotWorkspace/wegotworkspace/issues/66)–[#70](https://github.com/WeGotWorkspace/wegotworkspace/issues/70) | Operations DI per product |
| [#71](https://github.com/WeGotWorkspace/wegotworkspace/issues/71) | Operations DI tracker |
| [#72](https://github.com/WeGotWorkspace/wegotworkspace/issues/72) | Storybook coverage audit + addon-vitest |

## Doc updates

- `AGENTS.md`, `.agents/README.md`, `.agents/POLICY.md`
- `docs/archive/agent-skills-multitask.md` (this file)
