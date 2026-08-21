# Security

## Supported versions

Please report vulnerabilities against the latest [release](https://github.com/WeGotWorkspace/wegotworkspace/releases). We do not backport security fixes to older tags while the project is pre-1.0.

## Report a vulnerability

**Do not** open a public issue for a security report.

Email **[legal@wegotworkspace.org](mailto:legal@wegotworkspace.org)**. Include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected version / commit if you know it

We aim to acknowledge within **7 days** and to say whether we accept the report within **14 days**.

For automated findings that are already public (for example a DAST ticket), use the [DAST finding](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=dast-finding.yml) template.

## What we run in CI

Pull requests to `main` run CodeQL, Semgrep, Gitleaks, and Trivy — see [`.github/workflows/security.yml`](.github/workflows/security.yml).
