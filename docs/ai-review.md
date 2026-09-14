# Advisory AI PR review

Automated pull-request review runs in CI when maintainers opt in. It posts a **single advisory comment** on each eligible PR — logic, architecture, policy, and smells — without modifying code or blocking merge.

**Policy:** optional for all PRs; not part of branch-protection required checks. Hard gates remain in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and [`.github/workflows/security.yml`](../.github/workflows/security.yml). See [.agents/POLICY.md](../.agents/POLICY.md).

## Current gating policy

| Setting | Value | Effect |
|---------|-------|--------|
| Repo variable `AI_REVIEW_ENABLED` | unset / not `true` | Workflow skipped entirely |
| Repo secret `ANTHROPIC_API_KEY` | required when enabled | Anthropic API access for Claude Code action |
| Draft PRs | skipped | Job `if` excludes `draft == true` |
| Fork PRs | skipped | Job `if` requires `head.repo.full_name == github.repository` |
| `paths-ignore` | generated artefacts | Workflow does not run when the PR **only** changes ignored paths |

**Decision:** advisory-only — compare to CodeQL/Semgrep (second opinion). Upgrading to a **required** check is a separate maintainer decision (add branch protection + change workflow to fail on findings).

## Enablement checklist (maintainers — requires secrets)

Complete in order; steps need org/repo admin access:

- [ ] Add repository secret `ANTHROPIC_API_KEY` (Anthropic Console → API keys).
- [ ] Set repository variable `AI_REVIEW_ENABLED` to `true` (Settings → Secrets and variables → Actions → Variables).
- [ ] Open or sync a non-draft PR from a branch in this repo; confirm an **Advisory AI review** comment appears.
- [ ] Confirm fork PRs do **not** run the job (expected — no confusing secret failures).
- [ ] Decide whether to keep advisory-only or promote to required check — document here and in `POLICY.md` if that changes.

Do **not** gate enablement on `secrets.ANTHROPIC_API_KEY != ''` in workflow `if` — GitHub Actions secret checks in `if` are unreliable. Use the repo variable only.

## What the review checks

Workflow: [`.github/workflows/ai-review.yml`](../.github/workflows/ai-review.yml)

Claude Code ([`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action)) reads:

| Source | Role |
|--------|------|
| [`.agents/POLICY.md`](../.agents/POLICY.md) | Policy rows for new work |
| [`.agents/skills/clean-code/smells.md`](../.agents/skills/clean-code/smells.md) | Structural smell scan |
| [`.agents/skills/code-review/SKILL.md`](../.agents/skills/code-review/SKILL.md) | Review order, blockers vs nits |

Output: one PR comment via `gh pr comment` — no file edits, no inline comments, no blocking review.

## paths-ignore rationale

Large generated diffs add cost without review value. The workflow trigger skips PRs that **only** touch:

| Pattern | Examples |
|---------|----------|
| `packages/api/openapi/generated/**` | `openapi-types.ts`, `openapi.built.json` |
| `**/dist/**` | Built UI bundles |
| `**/storybook-static/**` | Storybook export |
| `**/.turbo/**` | Turbo cache |

When a PR mixes generated and hand-written changes, the job runs; the prompt instructs the model to ignore generated paths in the diff.

## Fork pull requests

PRs from forks are **not** reviewed:

- Fork workflows cannot use upstream secrets safely without `pull_request_target`.
- This repo **does not** use `pull_request_target` for AI review (avoids running untrusted code with write access to the base repo).
- Expect no AI comment on external contributions — human review only.

## Costs

Each run consumes Anthropic API tokens (model + diff size). Mitigations:

- Default **off** until `AI_REVIEW_ENABLED=true`
- `paths-ignore` skips generated-only PRs
- `concurrency` cancels superseded runs on new pushes
- `timeout-minutes: 20` caps runaway jobs

Monitor usage in the Anthropic Console after enablement.

## Advisory vs required (upgrade path)

| Mode | Merge impact | How |
|------|--------------|-----|
| **Advisory** (current) | Comment only; merge allowed | Default — job always succeeds if the action completes |
| **Required** (future) | Block merge on failure | Add branch protection on the job + change workflow to fail when blockers are found (not implemented) |

Keep advisory until comment quality and false-positive rate are acceptable.

## Relation to existing CI

| Workflow | Role |
|----------|------|
| `ci.yml` | Required quality gates (lint, tests, build) |
| `security.yml` | SAST/SCA/secrets (CodeQL, Semgrep, Gitleaks, Trivy) |
| `ai-review.yml` | Optional advisory review (policy + smells + architecture) |

AI review complements human and static analysis; it does not replace done-gates or Husky pre-push checks.
