Source: #587 (body-hash: 4d2e62f4)

# Do not claim DAST until it runs

Technical translation of Task #587. Parent tracker is #584. Authenticated scanning stays on #593.

## Goal

Public docs name only security scanners whose jobs actually run, and they name when those jobs run in one place. The OWASP ZAP job stays in `.github/workflows/security.yml` with `if: false`. The enablement guide keeps saying that job is scaffolded and disabled.

## Non-goals

- Turning `dast-zap` on, or replacing `if: false` with `vars.ENABLE_DAST`
- Staging URL, `ENABLE_DAST`, ZAP credentials, or a login context (`#593`)
- Deleting the scaffolded job, rules file, or DAST issue template
- Adding a milestone to `#593`, or changing `legal@wegotworkspace.org` (a `security@` address belongs on `#592`)
- Rewriting intake copy that only points people at the DAST template (`GOVERNANCE.md`, `docs/product/README.md`)

## Affected packages

- Root docs: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`
- `.github/zap/README.md`
- `.github/ISSUE_TEMPLATE/dast-finding.yml`
- No `packages/api` or `packages/apps` changes
- No edit to `.github/workflows/security.yml`

## Technical constraints

Jobs that are not hard-disabled: CodeQL (JS/TS), Semgrep (PHP), Gitleaks, and Trivy. They run on pull requests from this repository, on pushes to `main` except a commit message that starts with `chore(release):`, and nightly (`0 3 * * *`). Fork pull requests are not claimed: the only fork (`MarijnDoeve/wegotworkspace`) has no pull request and no Security run here. Same-repository evidence is Actions run 35999292946, where those four jobs succeeded and `DAST (OWASP ZAP)` was skipped.

The full cadence sentence lives only in `SECURITY.md`. `README.md` names the four tools and points there.

`dast-zap` stays `if: false`. A skipped required check counts as success, so `DAST (OWASP ZAP)` must not be a required status check. Do not rename the job.

The DAST issue template is only for a finding that is already public. A report that is not yet public follows `SECURITY.md` (email `legal@`, no public issue).

`#582` is merged. `SECURITY.md` is on `main`.

English only.

## Edge cases

- Do not write “on every pull request.” Fork `pull_request` runs get no secrets and a read-only token.
- Branch protection could not be read with the agent token (HTTP 403). Rulesets showed only a disabled Copilot ruleset. That list is not proof. If `DAST (OWASP ZAP)` is required, remove that context before merge.
- The zap README enablement list stays, so `#593` still has a written path.
