Source: #587 (body-hash: 4d2e62f4)

# Do not claim DAST until it runs

Technical translation of Task #587. Parent tracker is #584 (release-quality bar, not a product Goal). Authenticated scanning stays on #593.

## Goal

Public docs name only security scanners whose jobs actually run. The OWASP ZAP job stays in `.github/workflows/security.yml` with `if: false`, and the enablement guide keeps saying that job is scaffolded and disabled.

## Non-goals

- Turning `dast-zap` on, or replacing `if: false` with `vars.ENABLE_DAST`
- Staging URL, `ENABLE_DAST`, ZAP credentials, or a login context (`#593`)
- Deleting the scaffolded job, rules file, or DAST issue template
- Adding a milestone to `#593`
- Rewriting intake copy that only points people at the manual DAST template (`GOVERNANCE.md`, `docs/product/README.md`)

## Affected packages

- Root docs: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`
- `.github/zap/README.md` (confirm the disabled sentence; tighten present tense only if it reads as “this runs today”)
- `.github/ISSUE_TEMPLATE/dast-finding.yml` (the sentence that says the security workflow creates ZAP findings)
- No `packages/api` or `packages/apps` changes

## Technical constraints

Jobs in `.github/workflows/security.yml` that are not hard-disabled:

- `SAST (CodeQL JS/TS)`
- `SAST (Semgrep PHP)`
- `Secrets (Gitleaks)`
- `SCA (Trivy)`

`dast-zap` (`DAST (OWASP ZAP)`) is `if: false`. Required-check docs in `.agents/skills/git-workflow/pull-requests.md` already list those four jobs and omit ZAP. Leave that list alone unless a doc edit would make it stale.

`#582` is merged. `SECURITY.md` is on `origin/main`. The third acceptance criterion is a check, not new legal-doc work.

English only.

## Audit (origin/main at plan time)

| Surface | Current claim | Action |
|---------|---------------|--------|
| `README.md` Maintainers “Security CI” | Names CodeQL, Semgrep, Gitleaks, and Trivy | Keep. Do not add ZAP. |
| `SECURITY.md` “What we run in CI” | Same four tools | Keep. |
| `SECURITY.md` report section | “automated findings that are already public (for example a DAST ticket)” | Rewrite so a public finding may use the template, without saying CI files DAST tickets today. |
| `CONTRIBUTING.md` “What is open today” | Row “Security / DAST findings” points at the template | Keep the template as an intake path. Do not describe ZAP as a running scanner. If the row reads as “DAST runs”, retitle it as a manual report channel. |
| `.github/zap/README.md` | First paragraph: job is **scaffolded but disabled** | Keep that sentence. “Enable DAST” stays future steps for `#593`. Severity-policy lines in present tense (“ZAP creates GitHub Issues”) should say that happens only after the job is enabled. |
| `.github/ISSUE_TEMPLATE/dast-finding.yml` | “findings created by the security workflow” | This is the false claim. Say the template is for a manual report. Mention the workflow only as future behavior after `#593`. |
| `GOVERNANCE.md`, `docs/product/README.md` | External intake may use the DAST template | Out of the issue checklist. Leave unless a sentence says the scan runs. |
| `security.yml` `dast-zap` | `if: false` plus a comment pointing at the zap README | Do not edit the condition. A skipped job may still show the name `DAST (OWASP ZAP)` in Actions; that is the scaffold, not a doc claim that it runs. |

## Edge cases

- A skipped Actions job is not evidence the scanner runs. Do not rename or remove `dast-zap` in this task.
- Branch-protection required checks could not be read from this environment (API 403). If `DAST (OWASP ZAP)` is required, that is an ops follow-up, not a doc edit and not permission to enable the scan.
- The zap README enablement list must stay, so `#593` still has a written path. The opening “disabled” sentence is what satisfies the issue.
