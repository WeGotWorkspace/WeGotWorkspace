# Docker install — operations & contributors

End-user install steps live in [install-docker.md](install-docker.md). This page is for **maintainers** cutting releases and **contributors** validating the install stack.

## GHCR must be public

The install path pulls `ghcr.io/wegotworkspace/wegotworkspace:{version}` without registry credentials. The package **must be public** so anonymous `docker pull` works on operator hosts.

**Org policy gotcha:** GitHub Organizations can restrict package visibility via **Settings → Member privileges → Package creation** and inherited access rules. Even when CI pushes successfully, a private or org-restricted package breaks fresh installs with `unauthorized` or `denied` pull errors.

After each release, confirm visibility on the package settings page:

[github.com/orgs/WeGotWorkspace/packages/container/package/wegotworkspace/settings](https://github.com/orgs/WeGotWorkspace/packages/container/package/wegotworkspace/settings)

Set **Change visibility** to **Public** if needed. Test without logging in:

```bash
docker logout ghcr.io 2>/dev/null || true
docker pull ghcr.io/wegotworkspace/wegotworkspace:VERSION
```

## Maintainer release checklist

Before announcing a Docker-capable release:

| Step | What to verify |
| --- | --- |
| **Assets uploaded** | GitHub Release includes `install`, `setup.sh`, `docker-compose.yml`, `env.example`, `manifest.json`, `wgw-docker-install-{version}.tar.gz` (see [Release assets](install-docker.md#release-assets)) |
| **CI smoke green** | `release.yml` job **Smoke test install stack** passed — compose up, migrator, health, config persistence, bare container |
| **Wizard e2e green** | Tag-run **install-e2e** matrix passed (ZIP/Docker × SQLite/MariaDB 11) — this is the last gate **before** GHCR/asset upload; not the same as the post-publish compose smoke |
| **GHCR public** | Anonymous `docker pull` succeeds (see above) |
| **Multi-arch manifest** | Image lists both `linux/amd64` and `linux/arm64` (see [Apple Silicon & ARM](#apple-silicon--arm)) |
| **Spot-check `curl \| sh`** | On a clean directory, run the one-liner; confirm health and `/install/` load. Prefer an **arm64 Mac** host when validating Apple Silicon |
| **Upgrade UX** | On an existing install: `bash setup.sh check`, `bash setup.sh upgrade --dry-run`, then `bash setup.sh upgrade --yes` (or explicit version) |

Quick manifest inspection:

```bash
docker manifest inspect ghcr.io/wegotworkspace/wegotworkspace:VERSION | grep -E '"architecture"|"os"'
```

## Upgrades: user-initiated only (no Watchtower)

Production Docker installs upgrade **only** when an operator runs `setup.sh upgrade` (or the `curl … | sh -s -- --upgrade` equivalent). There is no bundled auto-updater on release publish.

**Do not** document [Watchtower](https://containrrr.dev/watchtower/) or similar as a recommended path. Immutable image tags plus explicit operator control match self-hosted security norms (same model as Plane and similar products).

If you must run a third-party auto-pull tool anyway — **advanced, at your own risk**:

- Pin by **digest**, not `:latest`
- Understand that upgrades run the migrator and can block web startup on failed migrations
- Take backups before any automated pull

See [Updates and backups](install-docker.md#updates-and-backups) for the supported upgrade flow.

## Docker channel — Admin Updates disabled

Docker installs are tagged at seed time with `WGW_INSTALL_CHANNEL=docker` in `api.env` (symlinked to `packages/api/.env`). This is not a ZIP/SFTP deployment — the admin web updater replaces files inside the container filesystem and must not be used.

### Config lifecycle on the `wgw-install-config` volume

| Phase | Keys in `api.env` | Written by |
| --- | --- | --- |
| Pre-install | `WGW_INSTALL_*`, `WGW_INSTALL_CHANNEL` | [wgw-install-seed-config.sh](../docker/install/wgw-install-seed-config.sh) + operator compose `.env` |
| Post-install runtime | `WGW_DATA_DIR`, `WGW_DB_*`, `WGW_UPDATE_FEED_URL` | Web installer / `wgw:install` (`InstallerEnvWriter`) |

Legacy `wgw-config.php` on the volume is removed on first boot after upgrade (migrated into `WGW_*` keys, backup kept).

| Surface | Docker channel behavior |
| --- | --- |
| **Admin → Updates** | Read-only installed version; **no** “Check for updates” apply path or “Update to …” button |
| **Upgrade instructions** | Copy-paste host commands: `bash setup.sh check` / `bash setup.sh upgrade` |
| **API** | `UpdateRunner` returns **403** if apply is attempted on the docker channel |

ZIP installs (`channel=zip` or unset) keep the normal Admin → Updates flow. Operators on Docker should use `setup.sh` only — details in [install-docker.md § Lifecycle commands](install-docker.md#lifecycle-commands).

## `setup.sh` discovery commands (Phase 8)

These commands ship in release `setup.sh` / `install` assets. Full operator examples are in [install-docker.md](install-docker.md#lifecycle-commands).

| Command | Behavior |
| --- | --- |
| `setup.sh status` | Install directory, pinned `WGW_IMAGE` tag, compose profile, health endpoint |
| `setup.sh check` | Fetch [manifest.json](https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/manifest.json) (same URL as ZIP Admin Updates), compare semver — **read-only**, does not pull or restart |
| `setup.sh upgrade` | Resolve latest from manifest, confirm (unless `--yes`), then backup → pull → migrator → web |
| `setup.sh upgrade X.Y.Z` | Explicit version — same backup → pull → up flow |
| `setup.sh upgrade --dry-run` | Print target version and steps without pulling or recreating |
| `setup.sh upgrade --yes` | Skip confirmation prompt (for scripts / `curl … --upgrade --yes`) |

`check` never auto-applies. Upgrades always pin `WGW_IMAGE` to a semver tag in `.env` (never `:latest`).

## Wizard install e2e (not in done-gate)

The four-cell wizard smoke (`ZIP|Docker` × `SQLite|MariaDB 11`) lives in [`tools/e2e-install-matrix.sh`](../tools/e2e-install-matrix.sh) and `pnpm test:install-e2e`. It is **not** part of `composer done-gate` / `pnpm test:api-done-gate`. It walks `/install/` on a **fresh deploy ZIP** (Docker cells rebuild [`Dockerfile.runtime`](../docker/install/Dockerfile.runtime) from that ZIP — not the monorepo `Dockerfile`).

On `main`, [`.github/workflows/install-e2e.yml`](../.github/workflows/install-e2e.yml) runs only when installer-relevant paths change. It is **not** required to merge. Release tags invoke the same reusable workflow from [`release.yml`](../.github/workflows/release.yml) **before** GHCR/asset upload.

```bash
# Reuse an existing deploy ZIP (preferred locally)
pnpm test:install-e2e -- zip sqlite

# Other cells (Docker rebuilds Dockerfile.runtime from the ZIP)
pnpm test:install-e2e -- docker sqlite
pnpm test:install-e2e -- zip mysql
pnpm test:install-e2e -- docker mysql

# Build a ZIP first if dist/releases/ is empty (slow: full UI + API build)
WGW_E2E_BUILD_ZIP=1 pnpm test:install-e2e -- zip sqlite
```

`WGW_E2E_ZIP` points at a specific `wegotworkspace-deploy-*.zip`. Do not set `WGW_INSTALL_HEADLESS=1` for this smoke — that is a different product path.

## Contributor testing matrix

Use the path that matches what you are validating. Do not use `compose.dev.yml` for install-stack testing — that is the monorepo dev stack ([dev-layout.md](dev-layout.md)).

| Option | When to use | Steps |
| --- | --- | --- |
| **A — Release `curl \| sh`** | Validate published assets and GHCR image as operators see them | `curl -fsSL https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/install \| sh` in an empty directory; complete wizard or hit health endpoint |
| **B — Local build** | Change `docker/install/` Dockerfile, compose, or migrator scripts | `cd docker/install && cp .env.example .env && docker compose up -d --build` |
| **C — `pnpm docker:install:*`** | Same as B from monorepo root (contributor shortcut) | `cp docker/install/.env.example docker/install/.env` then `pnpm docker:install:up` (also `docker:install:down`, `docker:install:logs`) |

Release bundles ship a **pull-only** `docker-compose.yml` (no `build:` stanza). Option A is the only way to exercise the exact release compose file against GHCR.

Pre-release testing from a clone without publishing to GHCR: use Option B or C (local build).

## Apple Silicon & ARM

Releases publish a multi-arch OCI manifest (`linux/amd64` + `linux/arm64`) via CI ([`.github/workflows/release.yml`](../.github/workflows/release.yml)). CI builds the image from [`Dockerfile.runtime`](../docker/install/Dockerfile.runtime), which unpacks the pre-built deploy ZIP from the runner; local `docker compose up --build` still uses [`Dockerfile`](../docker/install/Dockerfile) (full monorepo build).

| Host | Behavior |
| --- | --- |
| **Apple Silicon (M1/M2/M3)** on **current releases** | Native `linux/arm64` image when the manifest includes arm64 — no `--platform` flag needed |
| **Apple Silicon on old tags** (amd64-only) | `setup.sh` / `install` runs `ensure_docker_platform()`: detects missing arm64 in the manifest, sets `DOCKER_DEFAULT_PLATFORM=linux/amd64`, logs a Rosetta hint |
| **ARM Linux servers** | Same as above — prefer releases with arm64 in the manifest |

Operator requirements (Rosetta / emulation) are summarized in [install-docker.md § Requirements](install-docker.md#requirements).

Verify a tag before relying on native arm64:

```bash
docker manifest inspect ghcr.io/wegotworkspace/wegotworkspace:VERSION \
  | grep -E '"architecture": "(amd64|arm64)"'
```

Both architectures should appear for releases after multi-arch CI shipped ([#356](https://github.com/WeGotWorkspace/wegotworkspace/pull/356)).

## Related docs

- [install-docker.md](install-docker.md) — operator quick start, lifecycle, persistence, troubleshooting
- [getting-started.md](getting-started.md) — choose ZIP vs Docker vs dev
- [dev-layout.md](dev-layout.md) — monorepo development (`compose.dev.yml`, not install stack)
