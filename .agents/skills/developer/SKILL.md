---
name: developer
description: Context-loading guide for the WeGotWorkspace monorepo. Covers dev layout, skill routing, and critical constraints. Use when starting work, onboarding, or unsure which skill to load.
---

# WeGotWorkspace Developer

Context-loading skill for AI agents and developers working in the WeGotWorkspace monorepo. Loads relevant documentation based on your task.

## Quick decision matrix

**What are you doing?** → **Load this skill:**

| Task | Skill | Key docs |
|------|-------|----------|
| Starting work / skill routing | `developer` | [multitask.md](multitask.md), [done-checklist.md](done-checklist.md), [mcp-verification.md](mcp-verification.md), [POLICY.md](../../POLICY.md) |
| Handoff / verify before PR | `developer` | [mcp-verification.md](mcp-verification.md), [done-checklist.md](done-checklist.md) |
| Dev env / Docker / ports | [dev-environment](../dev-environment/SKILL.md) | `docs/dev-layout.md` |
| API / Laravel / REST / WebDAV | [api](../api/SKILL.md) | [layers.md](../api/layers.md), [testing.md](../api/testing.md) |
| Plugins / wgw-plugins | [plugins](../plugins/SKILL.md) | [storage-flysystem.md](../api/storage-flysystem.md) |
| Meet / RTC / room signaling | [meet](../meet/SKILL.md) | `packages/api/docs/meet-signaling.md` |
| UI primitives / CSS / styling | [apps-ui](../apps-ui/SKILL.md) | [components.md](../apps-ui/components.md), [typescript.md](../apps-ui/typescript.md) |
| Workspace shell / *App / *Workspace | [workspace](../workspace/SKILL.md) | [workspace-shells.md](../../../packages/apps/docs/workspace-shells.md), [feature-blueprint.md](../workspace/feature-blueprint.md), [collab-hooks.md](../workspace/collab-hooks.md), [apps-done-gate.md](../testing/apps-done-gate.md) |
| Collab / text-editor hooks (`docs-collab/`) | [workspace](../workspace/SKILL.md) | [collab-hooks.md](../workspace/collab-hooks.md), [clean-code/smells.md](../clean-code/smells.md) (React hooks) |
| Filing Goals / Epics / Tasks / Chores | [issue-filing.md](issue-filing.md) | [docs/product/](../../../docs/product/), [GOVERNANCE.md](../../../GOVERNANCE.md) |
| Planning a feature | [plan-feature](../plan-feature/SKILL.md) | [issue-filing.md](issue-filing.md) |
| Issue acceptance criteria / "is #N done?" | [verify-issue](../verify-issue/SKILL.md) | Goal vs Task modes in that skill |
| Writing or running tests | [testing](../testing/SKILL.md) | [test-first.md](../testing/test-first.md), [ui-architecture.md](../testing/ui-architecture.md) |
| Writing or updating docs | [document](../document/SKILL.md) | — |
| Branching / commits / PRs | [git-workflow](../git-workflow/SKILL.md) | [branches.md](../git-workflow/branches.md), [pull-requests.md](../git-workflow/pull-requests.md) |
| Code quality / refactor | [clean-code](../clean-code/SKILL.md) | [smells.md](../clean-code/smells.md) |
| PR review / handoff gate | [code-review](../code-review/SKILL.md) | [done-checklist.md](done-checklist.md), [POLICY.md](../../POLICY.md) |
| Storybook stories | [storybook](../storybook/SKILL.md) | [offline-first.md](../storybook/offline-first.md), [coverage.md](../storybook/coverage.md) |
| Accessibility / WCAG | [accessibility](../accessibility/SKILL.md) | [wcag.md](../accessibility/wcag.md) |

## Dev layout

See [dev-environment](../dev-environment/SKILL.md) for commands, URLs, and troubleshooting. Summary: `pnpm dev` → API http://127.0.0.1:9080, full app http://127.0.0.1:5173, Storybook http://127.0.0.1:6006 — [`docs/dev-layout.md`](../../../docs/dev-layout.md).

## Critical warnings

1. **API is greenfield Laravel** — no legacy PHP in tree; reimplement from OpenAPI → [api](../api/SKILL.md)
2. **No auto-commits** — only commit when the user asks → [git-workflow](../git-workflow/SKILL.md)
3. **UI styling: BEM classes + `@apply` in CSS** — not long Tailwind in TSX or raw CSS properties; primitives stay context-agnostic → [apps-ui](../apps-ui/SKILL.md)
4. **File I/O via Flysystem** — single storage layer for REST and WebDAV → [storage-flysystem.md](../api/storage-flysystem.md)
5. **Hook structure is a handoff gate** — when a feature adds multiple concerns to one hook, run a structure pass before handoff (split per [clean-code/smells.md](../clean-code/smells.md) React hooks section; collab layout in [collab-hooks.md](../workspace/collab-hooks.md)). Not optional nit — [code-review](../code-review/SKILL.md) blocks merge-ready work that violates thresholds without a documented exception.

## Multitask

When running parallel agents, see [multitask.md](multitask.md) for chunk splitting, handoffs, and post-parallel verification. After parallel builds merge, spawn a read-only verifier per [multitask-verifier.md](multitask-verifier.md) when chunks share contracts or boundaries. For issue-scoped work, run [verify-issue](../verify-issue/SKILL.md) before declaring done. Before declaring done: [done-checklist.md](done-checklist.md). Policy vs CI: [POLICY.md](../../POLICY.md).

## When NOT to use this skill

- Deep API work: load **api** directly
- UI refactoring: load **apps-ui** or **workspace** directly
- Simple one-off questions: ask directly without loading skills

## Related documentation

- Root: [AGENTS.md](../../../AGENTS.md)
- API done gate: `packages/api/docs/api-done-gate.md`
- Apps done gate: [testing/apps-done-gate.md](../testing/apps-done-gate.md)
- OpenAPI contract: `packages/api/openapi/openapi.json`
