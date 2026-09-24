# Do not claim DAST until it runs

Derived from [spec.md](./spec.md). One docs chunk. No API or UI work, so no parallel split.

## Goal

Make README, SECURITY, and contributing text name only scanners that run, keep `.github/zap/README.md` explicit that ZAP is scaffolded and disabled, and record that `#582` already put `SECURITY.md` on `main`.

## Non-goals

- Enabling `dast-zap` (`#593`, no milestone until a logged-in target exists)
- Changing `if: false` in `.github/workflows/security.yml`
- Product-roadmap or Goal edits (`#584` is an engineering tracker)

## Affected packages

- Root docs and `.github` issue/zap docs
- `.agents/specs/587-do-not-claim-dast/` (this plan)

## Dependencies

1. `#582` is already merged. Confirm `SECURITY.md` on `origin/main` before editing copy. Do not reopen `#582`.
2. Copy edits do not wait on `#593`. Do not start `#593` from this task.
3. Wording changes land together; there is nothing to parallelize.

## Chunks

### Chunk A: Align scanner claims with jobs that run

- **id:** `docs-honest-scanners`
- **Skill:** document
- **Inputs:** Audit table in [spec.md](./spec.md). Running jobs are CodeQL, Semgrep, Gitleaks, and Trivy. `dast-zap` stays `if: false`.
- **Done when:**
  - `README.md`, `SECURITY.md`, and `CONTRIBUTING.md` do not say OWASP ZAP or DAST runs in CI. They may name CodeQL, Semgrep, Gitleaks, and Trivy.
  - `SECURITY.md` no longer uses a DAST ticket as an example of an automated finding produced today.
  - `.github/ISSUE_TEMPLATE/dast-finding.yml` no longer says the security workflow creates the finding.
  - `.github/zap/README.md` still says the job is scaffolded and disabled. Enablement steps remain future instructions.
  - `security.yml` `dast-zap` is still `if: false`.
  - `#582` is merged and `SECURITY.md` is on `main` (already true; re-check, do not reimplement).
  - Issue `#587` acceptance criteria are mapped with [verify-issue](../../skills/verify-issue/SKILL.md) before handoff.
- **Verify with:**
  - `git grep -n -E 'ZAP|DAST|dast-zap' -- README.md SECURITY.md CONTRIBUTING.md .github/zap/README.md .github/ISSUE_TEMPLATE/dast-finding.yml`
  - `git diff origin/main -- .github/workflows/security.yml` is empty
  - `gh issue view 582 --json state --jq .state` is `MERGED`
  - `pnpm run check:agent-docs`
- **Parallel with:** none

## Test plan

- [ ] Re-read the four surfaces in the audit table against the grep above. Every ZAP/DAST hit is either “disabled / not running”, “manual template”, or “after the job is enabled”.
- [ ] `security.yml` `dast-zap` condition is still the literal `if: false`.
- [ ] `pnpm run check:agent-docs` (English prose plus doc links). No apps or API done gate: this chunk does not touch `packages/apps` or `packages/api`.
- [ ] Map each `#587` checkbox in the PR body. Check the GitHub boxes only when the copy is on the delivery branch:
  - README / SECURITY / contributing text only name scanners that actually run
  - `.github/zap/README.md` still says the job is scaffolded/disabled
  - `#582` is merged so `SECURITY.md` is on `main`

## Doc updates (only if user wants)

The issue **is** the doc update. Do not add a new security guide. Do not expand `.github/zap/README.md` into an auth design; that belongs to `#593`.
