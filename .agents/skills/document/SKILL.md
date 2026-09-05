---
name: document
description: Documentation workflow for the WeGotWorkspace monorepo — when and where to write docs, templates, and changelog rules. Use when updating README, API docs, dev-layout, or feature summaries.
paths:
  - "docs/**"
  - "packages/api/docs/**"
  - "**/README.md"
---

# Documentation

## When to write docs

Update docs when the user asks, or when shipping:

- New API domain or breaking HTTP contract
- Dev-layout / env / Docker workflow changes
- Feature blueprints worth preserving (link from plan archive)

## Where docs live

| Area | Path |
|------|------|
| Monorepo dev | `docs/` (`dev-layout.md`, `env.md`, `docs/plans/` archives, …) |
| API | `packages/api/docs/` |
| Package README | `packages/api/README.md`, root `README.md` |
| Agent skills | `.agents/skills/` sibling refs |

## Rule

**Do not** create markdown files the user did not ask for. Propose doc updates in chat; write only when requested or clearly part of the task.

**English only** — docs, plan archives, and GitHub-facing summaries are English even if the user prompt is Dutch ([english-only.md](../developer/english-only.md)). Chat replies may stay Dutch.

## Templates

### Feature summary (PR / plan archive)

```markdown
## Summary
[What shipped and why]

## Packages touched
- …

## Verification
- [ ] Tests: …
- [ ] Manual: …
```

### API domain note

When adding a domain to `packages/api/docs/`:

- Purpose and OpenAPI tag
- Auth requirements
- Done-gate checklist items
- Link to `openapi/openapi.json` paths

### Dev-layout change

When changing ports, commands, or Docker flow — update `docs/dev-layout.md`, [dev-environment](../dev-environment/SKILL.md), and cross-check [developer](../developer/SKILL.md) dev layout bullets.

## Changelog / commits

Only commit when the user explicitly asks. Use Conventional Commits per [git-workflow](../git-workflow/SKILL.md).

## Related skills

- Planning output format: [plan-feature](../plan-feature/SKILL.md)
- API done gate docs: `packages/api/docs/api-done-gate.md`
- Workspace feature structure: [workspace/feature-blueprint.md](../workspace/feature-blueprint.md) (split shell); shell choice: [packages/apps/docs/workspace-shells.md](../../../packages/apps/docs/workspace-shells.md)
