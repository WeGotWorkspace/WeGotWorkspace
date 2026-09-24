# Pull requests

Only open a PR when the user explicitly asks (e.g. "open a PR", "create a pull request").

**Always open it as a draft.** A draft is the holding pen: CI runs, and the PR stays out of the merge queue until the user asks to land it. Do not run `gh pr ready` or enable auto-merge on your own.

## Before push

**Apps (`packages/apps/**`):** Husky pre-push runs the local apps done gate when apps files changed in the push range (typecheck, OpenAPI contract, Storybook smoke, coverage). Vitest unit and jsdom run in CI. Run the local gate manually if hooks were skipped.

**Full stack before merge-ready PR** (when touching API or apps):

```bash
pnpm run ci:quality
```

For API contract work also run `pnpm test:api-done-gate` — see [testing](../testing/SKILL.md) and [developer/done-checklist.md](../developer/done-checklist.md).

Ensure commits are **signed** (required for merge to `main`).

**CI validates PR tip only** — `apps-quality` / `api-quality` run on branch HEAD. Intermediate commits may fail the done gate until fix-forward; do not treat old SHAs as merge blockers when HEAD is green ([#250](https://github.com/WeGotWorkspace/wegotworkspace/issues/250)).

## Push branch

```bash
git push -u origin HEAD
```

## Create PR (GitHub CLI)

```bash
gh pr create --draft --title "type(scope): short description" --body "$(cat <<'EOF'
## Summary
…

## Test plan
- [ ] …

EOF
)"
```

`--draft` is required. The Cursor hook rejects `gh pr create` without it.

**English only** for the PR title, body, and every review comment — even if the user prompt is Dutch ([english-only.md](../developer/english-only.md)).

Use the repo template sections where applicable — see [`.github/pull_request_template.md`](../../../.github/pull_request_template.md):

- **Summary** — what and why ([document](../document/SKILL.md) feature summary template)
- **Type of change** — check one box
- **How to test** — concrete steps ([testing](../testing/SKILL.md) commands)
- **Checklist** — local test, docs, tests updated
- **API changes** — only if `packages/api` touched (OpenAPI, `pnpm check:api-types`, feature tests)
- **Notes for reviewers** — trade-offs, follow-ups

PR title: same Conventional Commits style as commit subject when possible.

## Required CI (branch protection on `main`)

From root [README.md](../../../README.md):

- `build` (CI)
- `SAST (CodeQL JS/TS)`
- `SAST (Semgrep PHP)`
- `Secrets (Gitleaks)`
- `SCA (Trivy)`

Fix failing checks before expecting merge.

## Merging PRs

`main` uses a **merge queue**. Required checks run again on a temporary `merge_group` branch that already contains `main` and any pull requests ahead in the queue. Do not update a branch onto `main` by hand just to make it mergeable.

**Default: merge commit, via the queue.** Preserve branch commits on `main` — feature work is split into small, auditable Conventional Commits; squashing collapses that history.

Only when the user asks to land the PR:

```bash
gh pr ready <number>
gh pr merge <number> --auto --merge
```

Skip `gh pr ready` when the PR is already ready for review. `--auto` adds it to the queue once its own required checks are green. The queue then runs `merge_group` checks and merges.

Queue settings: merge method **merge**, build concurrency **2**, only merge non-failing pull requests, minimum and maximum group size **1**, status check timeout **120 minutes**.

Add `--delete-branch` only when the user asks to delete the remote branch after merge. The repo already deletes the head branch on merge.

### When to use squash or rebase

Use **`--squash`** or **`--rebase`** only when the user explicitly requests it, or when the branch is intentionally a single commit (e.g. a one-line hotfix with no meaningful intermediate history).

**Do not** default to `--squash` because GitHub allows it or because a prior merge used squash. **Do not** infer squash from recent PR history — agents have mixed strategies in the past.

### Before enqueueing

1. Confirm CI is green on the PR head (`gh pr checks <number>`).
2. Confirm the PR is not `DIRTY` (`gh pr view <number> --json mergeable,mergeStateStatus`). `BEHIND` is fine — the queue tests the pull request on top of current `main`.
3. Use the enqueue commands above unless the user overrides.

### Recognizing merge style on `main`

| Style | `main` commit message | Parents |
|-------|----------------------|---------|
| Merge commit (default) | `Merge pull request #N from …` | 2 |
| Squash | `title (#N)` | 1 |

## Agent rules

- **Do not** add Cursor attribution to PR titles or bodies (`Made with Cursor`, `Made-with: Cursor`, `Co-authored-by: Cursor`, etc.). CI and project hooks reject it.
- **Do not** push or open PRs unless the user asks.
- **Always** pass `--draft` to `gh pr create`. Do not mark ready or enqueue unless the user asks to land the PR.
- **Do not** force-push `main`.
- **Do not** skip hooks (`--no-verify`) unless the user explicitly requests it.
- **Do not** amend commits unless user requests it and amend rules are satisfied (unpushed, your commit, etc.).
- Use `gh` for all GitHub tasks (PR, checks, issues).
- **English only** for issue/PR text and comments — [english-only.md](../developer/english-only.md).
- **Enqueue with `--auto --merge` by default** — see [Merging PRs](#merging-prs). Never use `--squash` unless the user asks.
- **Issue linking:** `feat/` PRs close a **Task or Epic** (`fixes #N` / `closes #N`) — never a Goal alone as the sole closing issue. Spec `Source:` follows the same rule — [issue-filing.md](../developer/issue-filing.md), [verify-issue](../verify-issue/SKILL.md).

## After PR

User may ask to address review comments or CI failures — fix on the same branch, push, re-run checks.
