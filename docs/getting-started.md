# Getting started with WeGotWorkspace

WeGotWorkspace is a self-hosted office platform (files, mail, notes, contacts, tasks, meet, and more). Pick the install path that matches how you want to run it.

## Choose your path

| I want to… | Start here |
| --- | --- |
| **Install on shared Apache/PHP hosting** (cPanel, Plesk, SFTP upload) | [INSTALL.md](../INSTALL.md) — download the release ZIP from [GitHub Releases](https://github.com/WeGotWorkspace/wegotworkspace/releases) |
| **Install with Docker** (self-host on a VPS or homelab) | One command: `curl -fsSL https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/install \| sh` — details in [install-docker.md](install-docker.md) |
| **Develop or contribute** (clone the monorepo, HMR, tests) | [dev-layout.md](dev-layout.md) — `pnpm dev`; Docker install stack testing: [install-docker-ops.md](install-docker-ops.md) |

All production installs (ZIP or Docker) use the **same runtime tree**: `index.php`, `bootstrap/`, `packages/api/` (with `.env` / `WGW_*` config), and built `packages/apps/*/dist/`. The web installer at `/install/` is identical regardless of delivery channel.

## Why three top-level folders?

If you cloned the repository for development, the layout can look redundant. In practice:

| Path | Role |
| --- | --- |
| `packages/api` | Laravel API source (REST, WebDAV, CalDAV, CardDAV) |
| `packages/apps` | UI source (Vite/React modules — edit here during dev) |
| `apps/wegotworkspace` | **Runtime / install shell** — assembled by `pnpm build` for releases; not edited during normal development |

Day-to-day development runs Vite HMR from `packages/apps` and a host or Docker PHP API. The install shell is synced only for preview and release packaging.

## After install

1. Open `/install/` and complete the wizard (requirements, database, first account).
2. Sign in and connect WebDAV/CalDAV clients to your site URL.
3. Install optional plugins via **Admin → Plugins** ([plugins.md](plugins.md)).
4. Optional: connect Claude, ChatGPT, or Mistral as you via MCP after an administrator enables **Connected assistants** — [mcp-connect.md](mcp-connect.md). Discovery lives at the origin root (`/.well-known/oauth-*`), not under `/api`.

## Updates

- **ZIP installs:** Replace files in place per [INSTALL.md](../INSTALL.md); `.env`, `wgw-content/`, and user data are preserved. Use **Admin → Updates** in the web UI. Upgrades migrate legacy install config into `packages/api/.env` automatically (backup kept).
  - **Recovery:** If the database connection fails after upgrading from a pre–env-first release, run `php packages/api/artisan wgw:config-migrate` from the install root. If `.env` still has example `WGW_DB_*` placeholders, remove those keys and run the command again; legacy values are read from `wgw-config.php` or `wgw-config.php.bak.*`.
- **Docker installs:** Run `bash setup.sh check`, then `bash setup.sh upgrade` (latest from manifest) or `bash setup.sh upgrade X.Y.Z` (explicit tag). Non-interactive: `--yes`; preview: `--dry-run`. Or `curl .../install | sh -s -- --upgrade`. A one-shot **migrator** runs `wgw:schema-migrate` before web starts. **Do not** use Admin → Updates on Docker — that panel is read-only on the docker channel. See [install-docker.md](install-docker.md#updates-and-backups) and [install-docker-ops.md](install-docker-ops.md).

## Need help?

- Environment variables (contributor dev): [env.md](env.md)
- Docker dev stack (not production install): [../docker/README.md](../docker/README.md)
- Bug reports: [GitHub Issues](https://github.com/WeGotWorkspace/wegotworkspace/issues)
