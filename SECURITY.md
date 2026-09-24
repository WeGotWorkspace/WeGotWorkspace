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

Dependabot opens weekly version-update pull requests for `packages/api/composer.lock`, the root `pnpm-lock.yaml`, and GitHub Actions ([`.github/dependabot.yml`](.github/dependabot.yml)). Patch and minor updates are grouped. Major updates each open their own pull request.

Those version updates are not advisory-driven. GitHub opens a pull request for a specific advisory only after a maintainer enables **Dependabot security updates** in the repository settings. This repository change cannot turn that setting on. Until it is on, the weekly version-update pull requests are the only automated dependency bumps.

Trivy still fails pull requests on CRITICAL/HIGH in `packages/api/composer.lock`. The `pnpm-lock.yaml` scan includes dev dependencies (`TRIVY_INCLUDE_DEV_DEPS`) so a Vitest, Storybook, or ESLint advisory is in the same gate as production packages. It uploads results on pull requests and fails the workflow on pushes to `main`, on the existing nightly schedule, and on a manual `workflow_dispatch`. Composer stays a pull-request gate because those advisories show up much less often than npm advisories; a new npm advisory should not turn an unrelated pull request red.

Accepted CRITICAL/HIGH exceptions, when any exist, go in [`.trivyignore`](.trivyignore) with the date, why, and when to revisit. A note in this file does not waive a finding.
