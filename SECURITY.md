# Security

## Supported versions

Please report vulnerabilities against the latest [release](https://github.com/WeGotWorkspace/wegotworkspace/releases). We do not backport security fixes to older tags while the project is pre-1.0.

## Report a vulnerability

**Do not** open a public issue for a security report.

Email **[legal@wegotworkspace.org](mailto:legal@wegotworkspace.org)**.

Or use **Report a vulnerability** on the repository's [Security tab](https://github.com/WeGotWorkspace/wegotworkspace/security/advisories/new) (GitHub private vulnerability reporting). Same response windows.

Include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Affected version / commit if you know it

We aim to acknowledge within **7 days** and to say whether we accept the report within **14 days**.

A finding that is already public may use the [DAST finding](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=dast-finding.yml) template. A finding that is not yet public uses one of the private paths above. Do not open a public issue for it.

## What we run in CI

CodeQL (JS/TS), Psalm taint (PHP, `packages/api/app`), Semgrep, Gitleaks, and Trivy run from [`.github/workflows/security.yml`](.github/workflows/security.yml):

- on pull requests opened from this repository
- on pushes to `main`, except a commit whose message starts with `chore(release):`
- nightly at 03:00 UTC (`0 3 * * *`)
- on a manual `workflow_dispatch`

Push and pull request Gitleaks jobs scan only the new commits. Nightly and manual runs scan the full history. [`.gitleaks.toml`](.gitleaks.toml) extends the default rules and ignores two removed minified trees (`packages/openoffice-web/` and `packages/ui/storybook-static/`) that match `generic-api-key` on code identifiers such as `get_VKey`, `metaKey`, and React `key` props.

Dependabot opens weekly version-update pull requests for Composer (`packages/api`), the root npm lockfile, GitHub Actions, and Docker images under `docker/install` ([`.github/dependabot.yml`](.github/dependabot.yml)). Each ecosystem is one group covering major, minor, and patch updates, so those version updates arrive as a single pull request per ecosystem. Security updates are not part of those groups.

Those version updates are not advisory-driven. GitHub opens a pull request for a specific advisory only after a maintainer enables **Dependabot security updates** in the repository settings. This repository change cannot turn that setting on. Until it is on, the weekly version-update pull requests are the only automated dependency bumps.

Trivy still fails pull requests on CRITICAL/HIGH in `packages/api/composer.lock`. The `pnpm-lock.yaml` scan includes dev dependencies (`TRIVY_INCLUDE_DEV_DEPS`) so a Vitest, Storybook, or ESLint advisory is in the same gate as production packages. It uploads results on pull requests and fails the workflow on pushes to `main`, on the nightly schedule, and on `workflow_dispatch`. Composer stays a pull-request gate because those advisories show up much less often than npm advisories; a new npm advisory should not turn an unrelated pull request red.

Accepted CRITICAL/HIGH exceptions, when any exist, go in [`.trivyignore`](.trivyignore) with the date, why, and when to revisit. A note in this file does not waive a finding.
