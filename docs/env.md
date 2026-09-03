# Environment files

Three layers — keep secrets in one place per runtime.

| File | Loaded by | Purpose |
|------|-----------|---------|
| **`.env`** (repo root) | `tools/with-root-env.sh` → pnpm/turbo scripts | Release signing, `VHOST_DOMAIN`, dev-only flags (`WGW_DISABLE_LOGIN_THROTTLE`). Supports shell expansion (`$(cat …)`). |
| **`packages/api/.env`** | Laravel (`public/index.php`) | `APP_KEY`, database, mail, JWT, `WGW_*` API behavior. **This is the API runtime.** |
| **`.env.local`** (repo root) | Vite / Storybook | `VITE_*` and `WGW_PROXY_TARGET` for Live API stories and Vite dev. Copy from `packages/apps/.env.example`. |

## Rules

1. **Do not copy `APP_KEY` or DB credentials into the repo root** — Laravel reads `packages/api/.env` only.
2. **Do not copy Laravel secrets into `.env.local`** — the browser bundle must not see them; use `VITE_WGW_DEV_USERNAME` / `VITE_WGW_DEV_PASSWORD` for Storybook login only.
3. **`pnpm dev` / `pnpm dev:ui` / `pnpm preview` / `pnpm release` / `pnpm release:publish`** load root `.env` via `tools/with-root-env.sh`; the PHP API still uses `packages/api/.env` whether it runs on the host (`pnpm dev:api`) or in Docker (mount + entrypoint copy on release sync only).
4. After changing **`packages/api/.env`**, restart PHP (or `pnpm docker:up` again) so Laravel picks up changes.

## First-time API env

```bash
cp packages/api/.env.example packages/api/.env
php artisan key:generate --working-dir packages/api   # or set APP_KEY manually
bash packages/api/scripts/generate-jwt-keys.sh          # RS256 keys for auth/token
```

`pnpm dev:api` loads **repo-root** `.env` only for pnpm/turbo tooling (`tools/with-root-env.sh`). **Laravel reads `packages/api/.env` only** — put JWT paths and `APP_KEY` there, not in the repo root.

WeGotWorkspace **runtime** data uses `WGW_*` keys in `packages/api/.env` (loaded into `config/wgw.php` and `database.connections.wgw` via `WgwServiceProvider`).  
`DB_*` in the same file is for **Laravel framework** storage (sessions/cache when using database drivers).  
`wgw-content/` holds SQLite, files, and JWT keys.

| Prefix | Purpose |
|--------|---------|
| `WGW_DATA_DIR`, `WGW_DB_*`, `WGW_UPDATE_FEED_URL` | Post-install runtime (written by installer or legacy migrator) |
| `WGW_INSTALL_*` | Pre-install wizard / headless install autofill (Docker `api.env` seed) |
| `DB_*` | Laravel default connection (sessions, cache, queue — not WGW app data) |

### Apache / shared hosting

`.env.example` defaults to `SESSION_DRIVER=file`, `CACHE_STORE=file`, and `QUEUE_CONNECTION=sync` so a host does not need `packages/api/database/database.sqlite`.  
In-place updates **preserve** an existing `packages/api/.env`, session files, and logs. Each update backup also includes `packages-api.env` when present. Keep a host-level backup anyway.

### Database-backed Laravel drivers (optional)

To use `SESSION_DRIVER=database` or `CACHE_STORE=database`, create the framework DB and migrate:

```bash
mkdir -p packages/api/database
touch packages/api/database/database.sqlite
php artisan migrate --working-dir packages/api
```

That database is separate from `wgw-content/db.sqlite`.

## Storybook Live API

```bash
cp packages/apps/.env.example .env.local
# set VITE_WGW_DEV_USERNAME / VITE_WGW_DEV_PASSWORD
# WGW_PROXY_TARGET=http://127.0.0.1:9080   # default for pnpm dev / dev:api
# WGW_PROXY_TARGET=https://wegotworkspace.localhost   # when using pnpm docker:up:https only
# WGW_VITE_DEV_PORT=5174        # optional pin; pnpm dev also auto-picks the next free port
# WGW_VITE_PREVIEW_PORT=4174
# WGW_STORYBOOK_PORT=6007
# WGW_PHP_DEV_PORT=9081
```

See [`dev-layout.md`](dev-layout.md) for the default dev commands.
