# Install WeGotWorkspace with Docker

Production Docker install runs the **same document-root layout** as the release ZIP ([INSTALL.md](../INSTALL.md)). You do not need Node, pnpm, or a git checkout on the host.

For monorepo development (bind mounts, Vite HMR), use [dev-layout.md](dev-layout.md) and [docker/README.md](../docker/README.md) instead — that is **`compose.dev.yml`**, not this stack.

**Maintainers & contributors:** release checklist, GHCR visibility, testing matrix, and ARM notes — [install-docker-ops.md](install-docker-ops.md).

## Requirements

- Docker Engine 24+ and Docker Compose v2
- ~2 GB disk for the image; more for uploads and database volume
- **Apple Silicon (M1/M2/M3) / ARM:** current releases ship native `linux/arm64` plus `linux/amd64`. Older tags may be amd64-only — `install` / `setup.sh` then sets `DOCKER_DEFAULT_PLATFORM=linux/amd64` and logs a Rosetta hint. Enable x86_64/amd64 emulation in Docker Desktop when needed. See [install-docker-ops.md § Apple Silicon & ARM](install-docker-ops.md#apple-silicon--arm).

## Quick start (recommended)

One command — no git clone, no `chmod`, no separate start step:

```bash
curl -fsSL https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/install | sh
```

This creates `./wegotworkspace/` in the current directory (override with `WGW_INSTALL_DIR`), downloads the release `docker-compose.yml` and `.env`, pulls the image, starts the stack, and prints the installer URL when healthy.

Optional flags (pipe-friendly):

```bash
WGW_HTTP_PORT=9090 curl -fsSL .../install | sh
curl -fsSL .../install | sh -s -- --sqlite
curl -fsSL .../install | sh -s -- --version 1.2.0
```

Then open:

```text
http://localhost:8080/install/
```

Default host port is **8080** (`WGW_HTTP_PORT`).

### MySQL first-run defaults

When using the default MySQL stack (`COMPOSE_PROFILES=mysql`), use these in the installer:

| Field | Value |
| --- | --- |
| Host | `db` |
| Port | `3306` |
| Database / user / password | `wgw` (match `MARIADB_*` in `wegotworkspace/.env`) |

## Lifecycle commands

After the first install, use the same script from `wegotworkspace/` (or re-download `setup.sh` from GitHub Releases):

```bash
cd wegotworkspace
bash setup.sh status         # install dir, image tag, health, profile
bash setup.sh check          # compare installed tag to latest release
bash setup.sh start          # after stop
bash setup.sh stop
bash setup.sh restart
bash setup.sh logs
bash setup.sh backup
bash setup.sh upgrade        # latest from manifest.json (confirms interactively)
bash setup.sh upgrade 1.2.0  # explicit version — backup → pull → migrator → web
```

Check for updates (read-only — does not apply):

```bash
bash setup.sh check
# Up to date (1.2.0)
# or: 1.3.0 available (installed: 1.2.0)
```

Upgrade to the latest release (resolves version from [manifest.json](https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/manifest.json), same feed as Admin Updates on ZIP installs):

```bash
bash setup.sh upgrade              # prompts for confirmation
bash setup.sh upgrade --yes        # non-interactive
bash setup.sh upgrade --dry-run    # show target version only
```

Upgrade from anywhere (re-downloads assets into an existing install dir):

```bash
curl -fsSL .../install | sh -s -- --upgrade --yes
curl -fsSL .../install | sh -s -- --upgrade 1.2.0
```

Upgrades always pin `WGW_IMAGE` to a semver tag in `.env` (never `:latest`).

Run `bash setup.sh --help` for the full command list.

## SQLite only

```bash
curl -fsSL .../install | sh -s -- --sqlite
```

Or edit `wegotworkspace/.env`:

```bash
COMPOSE_PROFILES=sqlite
WGW_WAIT_FOR_DB=0
WGW_DB_HOST=
```

In the installer, choose **SQLite**. Data lives under the `wgw-content` volume.

## Contributor path (repo checkout)

Contributors validating the install stack should follow the [testing matrix in install-docker-ops.md](install-docker-ops.md#contributor-testing-matrix) (release `curl | sh`, local `docker compose --build`, or `pnpm docker:install:up`). Quick local build:

```bash
cd docker/install
cp .env.example .env
docker compose up -d --build
open http://localhost:8080/install/
```

Pre-release testing via the install script (build from clone, no GHCR pull):

```bash
bash tools/setup-docker-install.sh --local
```

`docker/install/docker-compose.yml` includes a `build:` stanza. Release bundles ship a pull-only compose file with no local build.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMPOSE_PROFILES` | `mysql` | `mysql` = web + MariaDB; `sqlite` = web only |
| `WGW_IMAGE` | pinned at install time | GHCR image tag |
| `WGW_HTTP_PORT` | `8080` | Host port mapped to container HTTP :80 |
| `WGW_WAIT_FOR_DB` | `1` | Entrypoint/migrator wait for MySQL before proceeding |
| `WGW_DB_HOST` | `db` | MySQL hostname (Compose service name) |
| `WGW_DB_PORT` | `3306` | MySQL port |
| `WGW_DB_USERNAME` | `wgw` | Credentials passed to DB wait probe |
| `WGW_DB_PASSWORD` | `wgw` | Credentials passed to DB wait probe |
| `MARIADB_ROOT_PASSWORD` | `wgw-root` | MariaDB root password |
| `MARIADB_DATABASE` | `wgw` | Database created on first boot |
| `MARIADB_USER` | `wgw` | Application database user |
| `MARIADB_PASSWORD` | `wgw` | Application database password |

Change default passwords before exposing the stack to a network.

## Installer environment (`WGW_INSTALL_*`)

Set these in `packages/api/.env` (Docker: the `api.env` file on the `wgw-install-config` volume). They prefill the first-run installer and can skip the web UI entirely when headless install is complete.

| Variable | First-run screen | Purpose |
| --- | --- | --- |
| `WGW_INSTALL_HEADLESS` | — | `1` enables migrator `wgw:install` before web (skip first-run when all required vars set) |
| `WGW_INSTALL_DB_DRIVER` | Database | `sqlite` or `mysql` (when set, first-run skips the Database screen) |
| `WGW_INSTALL_DB_SQLITE_PATH` | Database | SQLite path (default `wgw-content/db.sqlite`) |
| `WGW_INSTALL_DB_HOST` | Database | MySQL host (Docker default: `db`) |
| `WGW_INSTALL_DB_PORT` | Database | MySQL port (default `3306`) |
| `WGW_INSTALL_DB_DATABASE` | Database | MySQL database name |
| `WGW_INSTALL_DB_USER` | Database | MySQL user |
| `WGW_INSTALL_DB_PASSWORD` | Database | MySQL password |
| `WGW_INSTALL_BASE_URI` | (site defaults) | Public path prefix (e.g. `/` or `/wgw/`) |
| `WGW_INSTALL_BASE_URI_AUTO` | (site defaults) | `1` to derive base URI from `APP_URL` or request path (headless requires this or explicit `WGW_INSTALL_BASE_URI`) |
| `WGW_INSTALL_TIMEZONE` | (site defaults) | PHP timezone (default `UTC`) |
| `WGW_INSTALL_ADMIN_USERNAME` | Account | First admin username |
| `WGW_INSTALL_ADMIN_EMAIL` | Account | Admin email |
| `WGW_INSTALL_ADMIN_PASSWORD` | Account | Admin password (min 10 chars; never sent to the browser) |
| `WGW_INSTALL_ADMIN_DISPLAY_NAME` | Account | Optional display name |
| `WGW_INSTALL_ENABLE_FILES` | (site defaults) | Optional DAV toggles (default on) |
| `WGW_INSTALL_ENABLE_CALENDARS` | (site defaults) | Optional |
| `WGW_INSTALL_ENABLE_CONTACTS` | (site defaults) | Optional |
| `WGW_INSTALL_CHANNEL` | — | `docker` — disables Admin web updater (seeded automatically on Docker) |

**Autofill:** partial `WGW_INSTALL_*` values pre-populate first-run (for example database from env skips the Database screen); the operator still confirms remaining screens.

**Headless:** when `WGW_INSTALL_HEADLESS=1` and all required vars are set (database, admin account, `WGW_INSTALL_BASE_URI` or `WGW_INSTALL_BASE_URI_AUTO=1`), the migrator runs `php artisan wgw:install` before Apache starts — open `/login` with no first-run clicks. Incomplete env falls back to first-run (never half-installs). Requirements checks still run.

On MySQL Docker installs, [wgw-install-seed-config.sh](../docker/install/wgw-install-seed-config.sh) writes database `WGW_INSTALL_*` keys into `api.env` from compose env (`WGW_DB_*`, `MARIADB_*`).

Example headless `.env` fragment (add to `wegotworkspace/.env`; migrator passes `WGW_INSTALL_HEADLESS` into the container):

```bash
WGW_INSTALL_HEADLESS=1
WGW_INSTALL_BASE_URI=/
WGW_INSTALL_ADMIN_USERNAME=admin
WGW_INSTALL_ADMIN_EMAIL=admin@example.com
WGW_INSTALL_ADMIN_PASSWORD=your-long-password
```

## What persists

Named volumes (survive `docker compose down` and image updates):

| Volume | Mount | Contents |
| --- | --- | --- |
| `wgw-content` | `/var/www/html/wgw-content` | SQLite DB (if used), uploads, JWT keys, `.installed` lock |
| `wgw-api-storage` | `/var/www/html/packages/api/storage` | Laravel storage, sessions, logs |
| `wgw-install-config` | `/wgw-config-vol` | Install config (`api.env` → `packages/api/.env`) — **survives container recreate** |
| `wgw-db` | MariaDB data dir | MySQL database files (profile `mysql`) |

Application code in the image is replaced on update; volumes are **not** removed unless you run `docker compose down -v`.

## Boot sequence

Each `docker compose up` runs a **one-shot migrator** before the web container starts:

1. **Migrator** ([wgw-install-migrate.sh](../docker/install/wgw-install-migrate.sh)): waits for MySQL (if enabled), then:
   - Seeds [wgw-install-seed-config.sh](../docker/install/wgw-install-seed-config.sh) into the `wgw-install-config` volume (`api.env` with `WGW_INSTALL_*` pre-install keys).
   - **Fresh install** (no `wgw-content/.installed`): runs headless `wgw:install` when `WGW_INSTALL_HEADLESS=1` and env is complete; otherwise skips schema migration — the web first-run installer runs initial setup.
   - **Existing install**: runs `php artisan wgw:schema-migrate` (same as ZIP in-place updates).
2. **Web** entrypoint ([docker-entrypoint.sh](../docker/install/docker-entrypoint.sh)): symlinks `api.env` → `packages/api/.env`, ensures permissions, runs `key:generate` when needed, starts Apache.
3. **Scheduler** sidecar: loops `php artisan schedule:run` every 60 seconds (due Calendar/Task alarms and VAPID fallback). This is the Docker equivalent of host cron — **not** a `queue:work` daemon.

Failed migrations block the web service from starting, preventing a half-upgraded state.

## Updates and backups

### Upgrade to a new release

**Recommended** — check, then upgrade with the lifecycle script (includes backup):

```bash
cd wegotworkspace
bash setup.sh check
bash setup.sh upgrade              # latest from manifest.json
bash setup.sh upgrade 1.2.0        # explicit version
bash setup.sh upgrade --dry-run    # preview target without pulling
```

Or re-run the install script with `--upgrade`:

```bash
curl -fsSL .../install | sh -s -- --upgrade --yes
curl -fsSL .../install | sh -s -- --upgrade 1.2.0
```

`setup.sh check` only reports availability; it does not pull or restart containers.

Manual equivalent:

```bash
# Pin the new tag in wegotworkspace/.env
WGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:1.2.0

docker compose -f wegotworkspace/docker-compose.yml --env-file wegotworkspace/.env pull
docker compose -f wegotworkspace/docker-compose.yml --env-file wegotworkspace/.env up -d
```

The migrator runs automatically before Apache serves traffic.

### Do not use Admin → Updates on Docker

Docker installs are seeded with `WGW_INSTALL_CHANNEL=docker`. **Admin → Updates** is disabled for this channel: the panel shows your installed version and host upgrade commands only (`bash setup.sh check` / `bash setup.sh upgrade`). Apply/download actions are hidden; the API rejects in-container file replacement ([UpdateRunner](../packages/api/app/Services/Update/UpdateRunner.php) returns 403).

Upgrade **only** by pulling a new image tag via `setup.sh` (see [Lifecycle commands](#lifecycle-commands)). The admin web updater is for ZIP/Apache hosting installs. Details: [install-docker-ops.md § Docker channel](install-docker-ops.md#docker-channel--admin-updates-disabled).

Upgrades are **user-initiated** — there is no recommended auto-pull sidecar (e.g. Watchtower). See [install-docker-ops.md](install-docker-ops.md#upgrades-user-initiated-only-no-watchtower).

### Backup

```bash
cd wegotworkspace
bash setup.sh backup
```

This archives named volumes and (when using MySQL) dumps the database to `wegotworkspace/backups/<timestamp>/`.

Manual MySQL dump:

```bash
docker compose -f wegotworkspace/docker-compose.yml --env-file wegotworkspace/.env exec db \
  mariadb-dump -u root -p"$MARIADB_ROOT_PASSWORD" wgw > wgw-backup.sql
```

## Health check

```bash
curl -fsS http://localhost:8080/api/v1/health
# {"status":"ok", ...}
```

Compose and the container `HEALTHCHECK` use the same endpoint.

## Build the image locally

From a git checkout (used when `WGW_IMAGE` is unset or you pass `--build`):

```bash
cd docker/install
cp .env.example .env
docker compose up -d --build
```

The Dockerfile runs `pnpm build` and the release packager — expect several minutes on first build.

## Release assets

Each tagged GitHub Release includes:

| Asset | Purpose |
| --- | --- |
| `install` | One-liner entry for `curl \| sh` |
| `setup.sh` | Same script — lifecycle commands |
| `docker-compose.yml` | Pull-only stack with migrator |
| `env.example` | Release env template (no leading dot — GitHub strips dotted names). Install writes `wegotworkspace/.env.example` and `wegotworkspace/.env` |
| `wgw-docker-install-{version}.tar.gz` | All of the above in one archive |
| GHCR image | `ghcr.io/wegotworkspace/wegotworkspace:{version}` (must be **public** for anonymous pull) |

Maintainers: pre-release checklist (smoke job, GHCR visibility, multi-arch manifest, spot-check `curl | sh`) — [install-docker-ops.md § Maintainer release checklist](install-docker-ops.md#maintainer-release-checklist).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/install/` 404 | Container health: `bash setup.sh logs` or `docker compose ps`; wait for `healthy` |
| MySQL connection failed in first-run | `COMPOSE_PROFILES=mysql`, host `db`, credentials match `.env` |
| Port in use | Change `WGW_HTTP_PORT` (default 8080 avoids dev stack :9080) |
| Web won't start after upgrade | Check migrator logs: `docker compose logs migrator` — migration may have failed |
| Config lost after recreate | Ensure `wgw-install-config` volume exists; do not use `docker compose down -v` unless intentional |

## TLS (HTTPS)

Automatic TLS termination is not included in the default stack. Terminate HTTPS on a reverse proxy (Caddy, Traefik, nginx) in front of `WGW_HTTP_PORT`, or use your platform’s load balancer. A dedicated Compose TLS profile may be added later.
