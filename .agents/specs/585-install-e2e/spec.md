Source: #585 (body-hash: 2ba98b2f)

# Install e2e matrix (ZIP/Docker × SQLite/MariaDB)

Technical translation of Task #585. Parent quality bar: #584. Not a product Goal and not a copy of the issue AC checklist.

## Goal

Prove a **fresh release artifact** (deploy ZIP, or the runtime image rebuilt from that ZIP) can be installed through the **web wizard** (not headless `wgw:install`) and that the created admin can sign in. Optional cheap extra: one authenticated API write. Four cells share one Playwright spec and one harness script.

## Non-goals

- Headless install, legacy `wgw-config.php` migration, `setup.sh upgrade`
- Mail/IMAP or Meet RTC
- Apps Playwright in done-gate / composer `done-gate`
- Multi-arch qemu (amd64 on `ubuntu-latest`)
- Required check on PR/merge
- Nightly cron
- Replacing the existing post-publish migrator/volume smoke in `release.yml`

## Affected packages

- `packages/api/e2e` — `install.fresh.spec.ts` (keep `install.wizard.spec.ts`)
- `tools/e2e-install-matrix.sh` + root `pnpm test:install-e2e`
- `.github/workflows/install-e2e.yml`, `install-e2e-reusable.yml`, `release.yml`
- Maintainer notes in `docs/install-docker-ops.md` and `packages/api/docs/api-done-gate.md`

## Technical constraints

- Artifact is the **deploy ZIP**, not the monorepo-dev tree. Docker cells rebuild `docker/install/Dockerfile.runtime` from that ZIP and compose **without** `--build`.
- Wizard path: Welcome → Server check → Database → DAV defaults → Skip Mail → Skip Meet → Admin → Finish → Sign in.
- Env: `WGW_INSTALL_BASE_URL`, `WGW_E2E_DB` (`sqlite` | `mysql`), fixed admin credentials. `WGW_DISABLE_LOGIN_THROTTLE=1`. Do **not** set `WGW_INSTALL_*` prefills that skip the wizard (`WGW_INSTALL_HEADLESS=0`). Docker seed may fill DB host (`db`) while headless stays off.
- MySQL cells use **`mariadb:11`** (same as `docker/install/docker-compose.yml`). ZIP wizard talks to `127.0.0.1`; Docker wizard host is `db`.
- Selectors: existing copy (`Continue`, `Skip for now`, `Finish install`, `SQLite` / `MySQL / MariaDB`, `Sign in`). No `data-testid` unless a step is unreliable.
- Fail hard if `installed === true` (no silent skip). Opt-in via `WGW_INSTALL_FRESH=1` so default `pnpm test:api-e2e` does not run this spec.
- CI: path-filtered `main` (not merge-blocking); unfiltered tag run from `release.yml` **before** GHCR/asset upload. ZIP-only artifacts (`retention-days: 1`). No `docker save`. Playwright traces on failure (`retention-days: 3`). Harness `set -euo pipefail` and 90s wait caps.

## Edge cases

- Server-check must be green (`InstallerEnvChecker` required extensions + writable dirs). IMAP is optional.
- MariaDB *Test connection* runs automatically on Continue when `mysqlTest` is not already `ok`.
- Finish install may redirect to `/admin/updates` (then login) or show the done pane *Open admin panel*.
- Path-filter on `main` can miss indirect breaks (`UiStaticServer`, `index.php`, shared routes). The unfiltered tag-run is the authority for those.
