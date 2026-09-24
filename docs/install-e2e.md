# Fresh install e2e

This smoke is **not** part of `composer done-gate` or the apps done gate. It proves a release ZIP can be installed through the first-run UI.

## Local run

Build a release ZIP first (`pnpm run build`, then `node tools/build-wegotworkspace-release.mjs`). The ZIP must already contain `packages/api/vendor/`. If that directory is missing, the harness exits non-zero.

```bash
CHANNEL=zip DB=sqlite pnpm test:install-e2e
CHANNEL=zip DB=mariadb pnpm test:install-e2e
CHANNEL=docker DB=sqlite pnpm test:install-e2e
CHANNEL=docker DB=mariadb pnpm test:install-e2e
```

`CHANNEL` is `zip` or `docker`. `DB` is `sqlite` or `mariadb`. Docker cells build `docker/install/Dockerfile.runtime` locally when `WGW_INSTALL_E2E_IMAGE` is unset. They never build `docker/install/Dockerfile`.

`composer install` runs only when you set `WGW_INSTALL_E2E_DEV_COMPOSER=1` for a local tree that is not a release ZIP. CI never sets that flag.

## CI

- Push to `main` on installer paths runs all four cells and does not block merge.
- A tag runs `install-gate` (`zip-sqlite`) before publish, and `install-observe` (the other three) without blocking publish.
- Promote a cell by editing the `RELEASE_GATE_CELLS` env in `.github/workflows/release.yml` after **2 consecutive** green runs on `main`, `workflow_dispatch`, or a tag. Observe cells are the other three, derived from that list. A red run, including a red observe cell, resets that cell.

## Images

The build job always pushes a new amd64 image to the private package `ghcr.io/wegotworkspace/wegotworkspace-candidate` (tag `sha-<commit>`), including when a tag workflow is re-run. Cells pull that digest. After the gate, `imagetools` copies the tested amd64 digest and the arm64 digest onto `ghcr.io/wegotworkspace/wegotworkspace:<version>`. `:latest` moves only for a stable `vX.Y.Z` tag.

Cell jobs need `packages: read` and `docker login ghcr.io` with `GITHUB_TOKEN`. They do not receive repository secrets. The promote job reads `wegotworkspace-candidate` and writes `wegotworkspace`. Grant Actions access on **both** packages (package settings → Manage Actions access). Deleting old candidate versions needs the **Admin** role on `wegotworkspace-candidate`, not only write. A package first pushed with `GITHUB_TOKEN` links to this repo. The existing release package may not be linked. That setting is once, outside the workflow file. The production signing key is passed only when `sign_release` is true, which is tag builds. Path-filtered `main` builds are unsigned.

Candidate tags older than 7 days are deleted. Published releases keep their own blobs.

## Re-running an old tag

Use **Re-run all jobs**. **Re-run failed jobs** skips the build job. The failed cell then looks for a ZIP artifact that expires after 1 day and a candidate digest that cleanup may have removed after 7 days.
