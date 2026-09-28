# DAST (OWASP ZAP) — enablement guide

The `dast-zap` job in [`.github/workflows/security.yml`](../workflows/security.yml) is **scaffolded but disabled** until a staging environment and authenticated scan flow exist.

## Why it is disabled

- No public staging URL is configured in this repository yet.
- WeGotWorkspace requires login; an unauthenticated ZAP scan only exercises the login page and misses product surfaces.

## Enable DAST

1. **Repository variable** `STAGING_URL` — base URL, e.g. `https://staging.example.com`
2. **Repository variable** `ENABLE_DAST` — set to `true`
3. **Repository secrets** (when auth is ready):
   - `ZAP_STAGING_USERNAME`
   - `ZAP_STAGING_PASSWORD`
4. Update the `dast-zap` job `if:` condition in `security.yml` (see inline comments) so the job runs on:
   - nightly cron (`0 3 * * *`)
   - push to `main` only (not pull requests)
5. Configure authentication in [`.github/zap/zap-rules.conf`](zap-rules.conf) or add a ZAP context file (`.github/zap/zap-context.context`) with form-based or script-based login.

## Authentication resources

- [OWASP ZAP — Authentication](https://www.zaproxy.org/docs/authentication/)
- [zaproxy/action-full-scan](https://github.com/zaproxy/action-full-scan) — `rules_file_name`, `cmd_options`, `target`

## Severity policy (until v1.0)

- `fail_action: false` — findings are **non-blocking** once the job runs
- When the job is enabled, ZAP creates GitHub Issues (`issue_title: "DAST: ZAP full scan findings"`)
- When the job is enabled, reports are uploaded as the `zap-dast-report` workflow artifact

After v1.0, consider setting `fail_action: true` for HIGH/CRITICAL DAST alerts.

## Required org secret (all security jobs)

| Secret / variable | When | Purpose |
|-------------------|------|---------|
| `GITLEAKS_LICENSE` | Actions runs on org repos | Free license from [gitleaks.io](https://gitleaks.io). Dependabot cannot read Actions secrets, so those runs call `gitleaks detect` directly. |
| `STAGING_URL` | When DAST is enabled | Scan target |
| `ENABLE_DAST` | When DAST is enabled | Flip job on (`true`) |
| `ZAP_STAGING_USERNAME` / `ZAP_STAGING_PASSWORD` | When DAST is enabled | Staging login |
