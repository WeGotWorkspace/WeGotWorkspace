# Branching

## When to branch

- **Always** branch from `main` for feature work, fixes, refactors, and agent skills/docs — do not commit directly to `main`.
- Create a branch at the **start** of a task (or when the user asks for a new branch).
- One logical change per branch when practical; split large work per [plan-feature](../plan-feature/SKILL.md) chunks.

## Naming

Use **`<type>/<short-slug>`** (lowercase, hyphens):

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-facing behavior |
| `fix/` | Bug fixes |
| `refactor/` | Behavior-preserving restructure |
| `chore/` | Tooling, deps, agent skills, CI |
| `docs/` | Documentation-only |
| `test/` | Test-only changes |
| `migrate/` | Migrations or large mechanical moves |

Examples from this repo: `chore/agent-skills-multitask`, `fix/agpl-license`, `refactor/api-routes`.

Branch name should match the **primary commit type** when there is a single commit; use the dominant theme for multi-commit PRs.

## Commands

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/short-description
```

Only push when the user asks:

```bash
git push -u origin HEAD
```

## Multitask / parallel agents

- Prefer **one branch per independent chunk** when parallel agents work on separate worktrees.
- Create worktrees with [`tools/worktree-agent.sh`](../../../tools/worktree-agent.sh) — branch `<type>/<chunk-id>`, path `../<repo-name>-<chunk-id>`, per-worktree ports in `.env.local` (see [dev-layout.md](../../../docs/dev-layout.md#multiple-worktrees-port-conflicts)).
- Do not have two agents commit to the same branch without coordination.
- Merge order: respect dependencies from the plan (OpenAPI before UI consumers, etc.) — see [developer/multitask.md](../developer/multitask.md).

## Do not

- Force-push `main` or `master` (warn the user if they request it).
- Reuse unrelated branch names for new work — create a fresh branch from current `main`.
