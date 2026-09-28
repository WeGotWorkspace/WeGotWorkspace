Source: #585 (body-hash: 2ba98b2f)
Goal: #584

# Fresh install e2e matrix

Technical translation of Task #585. The live issue body still names the pre-#805 eight-step wizard and a few paths that moved (`packages/api/e2e`, `install-core`). GitHub denied `updateIssue` for this token, so the body was not rewritten. This spec is the implementation contract: the shipped first-run installer, the real paths, and the release-image rules agreed after the issue was filed.

## Goal

Prove a fresh release ZIP (not the monorepo tree) can be installed through the live first-run UI and that the admin session is real. Four cells: ZIP and Docker × SQLite and MariaDB 11. The Docker cells pull one amd64 candidate digest built from that same ZIP. Release tags are created from that digest only after the promoted cells pass.

## Non-goals

- Headless `WGW_INSTALL_HEADLESS=1`, legacy `wgw-config.php` migration, `setup.sh upgrade`
- Changing Mail or Meet installer behavior (Mail stays off, Meet stays on with public STUN)
- Apps Playwright inside the composer or apps done gate
- Multi-arch qemu for the matrix (arm64 is only an `imagetools` input)
- A required PR check or a nightly cron
- A percent coverage gate

## Affected packages

- `tools/` — harness, release ZIP is the input
- `tools/api-e2e` — `install.fresh.spec.ts`
- `.github/workflows` — path-filtered main workflow, reusable cells, `release.yml` gate
- `docker/install/Dockerfile.runtime` — index-digest pins
- `docs/install-e2e.md` — how to run it, GHCR access, re-run rule
- `.github/dependabot.yml` — docker ecosystem for `/docker/install` only

## Technical constraints

- Walk: Get started → automatic server check (fail on “Needs attention.”) → Database → Account → Ready → Open workspace. No DAV, Skip Mail, or Skip Meet screens.
- Signed-in proof is `GET /api/v1/me` with the bearer token from `localStorage` key `wgw.api.access_token` → 200 and the created username.
- Already installed → fail, never `test.skip`.
- Missing `packages/api/vendor/` → harness exit non-zero. `composer install` only when `WGW_INSTALL_E2E_DEV_COMPOSER=1`. CI never sets that flag.
- One ZIP artifact. `Dockerfile.runtime` unpacks `dist/releases/wegotworkspace-deploy.zip`, staged from that single artifact. The GitHub release upload attaches the same artifact and fails if a listed file is missing.
- The production signing key is used only when `sign_release` is true (tag builds). Path-filtered `main` uploads an unsigned ZIP. Cell jobs do not receive `secrets: inherit`.
- `RELEASE_GATE_CELLS` in `release.yml` is the only gate list. Observe cells are the complement of the four cell ids. An empty list fails the workflow. `zip-sqlite` stays in the gate.
- Candidate package `ghcr.io/wegotworkspace/wegotworkspace-candidate`, tag `sha-<commit>`, private. Cells `docker pull` the digest from that push. A re-run always pushes a new candidate.
- `imagetools create` writes `:<version>` on `wegotworkspace` from the tested amd64 digest plus arm64. `:latest` moves only for a stable `vX.Y.Z`.
- `install-gate` starts as `zip-sqlite` and blocks publish. `install-observe` runs the other three and does not block publish.
- `annotate-release` needs publish and observe, and runs only when `needs.publish.result == 'success'`.
- Cell jobs: `packages: read`, `docker login ghcr.io`, `timeout-minutes: 30`. Build job: `timeout-minutes: 45`. Wait loops: 45 × 2 seconds. Playwright `retries: 1`, test timeout 5 minutes, expect timeout 15 seconds.
- ZIP CI PHP needs `pdo_sqlite` and `pdo_mysql`.
- Base images are pinned to the manifest-list digest, not an amd64 platform digest.
- Cleanup deletes candidate tags older than 7 days. Docs say an old tag is retried with **Re-run all jobs**.

## Edge cases

- “Re-run failed jobs” skips the build job. The ZIP artifact expires after 1 day and the candidate after 7 days. Docs require **Re-run all jobs**.
- A red gate skips publish. `annotate-release` must not edit a release that was not created.
- A red observe cell is written to the job summary and, after a successful publish, to the release notes. It resets that cell’s promotion count. Promotion itself stays a manual list edit after 2 consecutive greens.
- Prerelease tags (`v0.9.0-rc.1`) get a version tag and do not move `:latest`.
- Local Docker may build `Dockerfile.runtime` when no digest is provided. It never builds `docker/install/Dockerfile`.
