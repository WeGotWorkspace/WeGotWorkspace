---
name: git-workflow
description: Git workflow for this repository — branching, commits, pull requests, signed commits, and CI gates. Use when creating branches, staging, committing, opening PRs, or asked about git workflow.
---

# Git workflow

## Quick decision matrix

| Task | Read |
|------|------|
| Creating or naming a branch | [branches.md](branches.md) |
| Staging / committing | This file (below) |
| Opening or updating a PR | [pull-requests.md](pull-requests.md) |
| Merging a PR | [pull-requests.md](pull-requests.md) — **`gh pr merge --merge` by default** |
| Issue linking on `feat/` | [pull-requests.md](pull-requests.md) (Task/Epic only — not Goal alone); [issue-filing.md](../developer/issue-filing.md) |
| PR summary wording | [document](../document/SKILL.md) |
| Test plan for PR | [testing](../testing/SKILL.md) |
| Parallel agent branches | [developer/multitask.md](../developer/multitask.md) |

## Commits

- **Do not** run `git commit` or create commits on your own initiative, including after finishing a task or refactor.
- **Only** stage and commit when the user clearly requests a commit (e.g. "commit", "commit this", "commit the diff").
- It is fine to run read-only git commands (`git status`, `git diff`, `git log`) for investigation without asking.
- **Do not** push to remote unless the user explicitly asks.

### Apps UI verification before push

When commits touch **`packages/apps/**`** (exports, panes, hooks, stories, CSS):

1. **Before push** (Husky enforces): `pnpm test:apps-done-gate` — typecheck, Vitest, Storybook smoke, coverage baseline.
2. **Before merge-ready PR** (when user asks): `pnpm run ci:quality` — full lint/format/typegen + API and apps done gates.

Targeted Vitest or Storybook runs during development are fine; they do not replace the done gate. CI (`apps-quality`) validates **branch HEAD** on the PR only — intermediate commits may fail until fix-forward ([#250](https://github.com/WeGotWorkspace/wegotworkspace/issues/250)). Per-SHA gate runs are for bisect/debug only.

## Conventional Commits (when the user asks you to commit)

Use **[Conventional Commits](https://www.conventionalcommits.org/)** for every commit message:

- **Format:** `<type>(<optional scope>): <description>`
  Example: `feat(settings): add mail transport label helper`
- **Common types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`
- **Description:** imperative mood, lowercase start (unless a proper noun), no trailing period; **subject line ~72 chars or less** when practical.
- **Body:** optional; use for **why** or non-obvious **what** (wrap at ~72 chars). Separate from subject with a blank line.
- **Breaking changes:** `!` after type/scope (e.g. `feat(api)!:`) and/or a `BREAKING CHANGE:` footer when appropriate.

Do not use vague one-word subjects (`fix`, `update`, `wip`) without a clear description after the colon.

## Repo constraints (summary)

- **Signed commits** not required (branch protection rule dropped Aug 2026 — cloud-agent friction; provenance moves to signed release tags). Signing your own commits is still welcome.
- **Branch protection:** PR required; CI checks must pass — see [pull-requests.md](pull-requests.md).
- **PR merge:** merge commit (`gh pr merge --merge`) unless the user explicitly asks for squash/rebase — preserves auditable commit history on `main`.
- Husky runs Prettier/ESLint/Pint on commit; Commitlint enforces Conventional Commits. CI rejects Cursor attribution in commit messages and PR descriptions; `.cursor/hooks` blocks `gh pr create` / `gh pr edit` with attribution in `--body`.
