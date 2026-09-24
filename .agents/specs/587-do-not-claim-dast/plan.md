# Do not claim DAST until it runs

Derived from [spec.md](./spec.md). One docs chunk. No API or UI work.

## Goal

Make README, SECURITY, and contributing text name only scanners that run. Put the cadence in `SECURITY.md` only. Keep `.github/zap/README.md` explicit that ZAP is scaffolded and disabled. Record that `#582` already put `SECURITY.md` on `main`.

## Non-goals

- Enabling `dast-zap` (`#593`, no milestone until a logged-in target exists)
- Changing `if: false` in `.github/workflows/security.yml`
- Replacing `legal@wegotworkspace.org` with `security@` (`#592`)

## Affected packages

- Root docs and `.github` issue/zap docs
- `.agents/specs/587-do-not-claim-dast/`

## Dependencies

1. `#582` is already merged. Do not reopen it.
2. Copy edits do not wait on `#593`. Do not start `#593`.
3. Do not merge while `DAST (OWASP ZAP)` is a required check. A skipped job counts as success for branch protection.

## Chunks

### Chunk A: Align scanner claims with jobs that run

- **id:** `docs-honest-scanners`
- **Skill:** document
- **Inputs:** [spec.md](./spec.md). Running jobs are CodeQL, Semgrep, Gitleaks, and Trivy. `dast-zap` stays `if: false`.
- **Done when:**
  - `SECURITY.md` states the cadence once: pull requests from this repository, pushes to `main` except `chore(release):`, and nightly `0 3 * * *`.
  - `README.md` names those four tools and points at `SECURITY.md` for when they run.
  - `SECURITY.md` does not use a DAST ticket as an example of an automated finding produced today.
  - `.github/ISSUE_TEMPLATE/dast-finding.yml` says: not yet public → `SECURITY.md`; already public → this template. It does not say the security workflow creates the finding.
  - `CONTRIBUTING.md` describes that public-report channel and does not say DAST runs.
  - `.github/zap/README.md` still says the job is scaffolded and disabled. Enablement steps remain. Present tense applies only after the job is enabled.
  - `security.yml` `dast-zap` is still `if: false`.
  - `#593` has no milestone.
  - Required checks on `main` do not include `DAST (OWASP ZAP)`, or the PR says the token could not read protection and a maintainer must confirm before merge.
- **Verify with:**
  - `rg -i 'zap|dast'` excluding `.github/workflows/security.yml`
  - `git diff origin/main -- .github/workflows/security.yml` is empty
  - `gh issue view 582 --json state --jq .state` is `MERGED`
  - `gh issue view 593 --json milestone` has no milestone
  - `pnpm run check:agent-docs`
- **Parallel with:** none

## Test plan

- [ ] Every remaining ZAP/DAST hit is “disabled,” “manual template for an already-public finding,” “private report via SECURITY.md,” or “after the job is enabled.”
- [ ] `security.yml` `dast-zap` condition is still the literal `if: false`.
- [ ] `pnpm run check:agent-docs`. No apps or API done gate.
- [ ] PR body uses `Closes #587` and records the branch-protection 403, the missing fork-PR run, and that `legal@` versus `security@` stays on `#592`.

## Doc updates (only if user wants)

The issue is the doc update. Do not add a new security guide. Do not expand `.github/zap/README.md` into an auth design.
