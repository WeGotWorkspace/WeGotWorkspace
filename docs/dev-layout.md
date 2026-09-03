# Development layout (source vs install runtime)

## Three layers

| Path | What it is | Built? |
|------|------------|--------|
| `packages/api` | Laravel **API app** (REST, WebDAV, UI kernels) | `composer install` only |
| `packages/apps` | UI **source** (Vite dev / build → `packages/apps/dist/`) | `vite dev` or `vite build` |
| `apps/wegotworkspace` | **Install shell** — `index.php`, `wgw-content/` (runtime data; `WGW_*` in `packages/api/.env`) | No code copies in day-to-day dev |

Production releases still assemble a self-contained tree under `apps/wegotworkspace/packages/*` via `pnpm build` / `pnpm release`. That sync is for shipping, not for editing.

## Default dev (Docker-free)

```bash
pnpm dev
```

| Service | URL | Notes |
|---------|-----|-------|
| Full app (HMR) | http://127.0.0.1:5173 | Vite dev server; proxies `/api/v1` → `:9080` |
| Storybook | http://127.0.0.1:6006 | Component catalog; same API proxy |
| API (host PHP) | http://127.0.0.1:9080 | Health: `/api/v1/health` |

The API task runs `packages/api/scripts/dev-php-server.sh`, which traps `SIGINT`/`SIGTERM` and stops the `php -S` process when you exit `pnpm dev` or `pnpm preview` (Ctrl+C). If `:9080` stays bound after a crash, find the listener with `lsof -nP -iTCP:9080 -sTCP:LISTEN` and stop it manually.

A second `pnpm dev` (another clone or git worktree) no longer fails when **5173 / 6006 / 9080** are taken. Startup prints the ports it actually bound (often **5174 / 6007 / 9081**) and points the Vite/Storybook proxy at that API. Pin ports in `.env.local` when you want them stable — see [Multiple worktrees](#multiple-worktrees-port-conflicts).

`pnpm dev` runs `wgw:dev-install` first (idempotent), then starts all three in parallel via turbo. On a fresh clone that bootstraps `packages/api/.env` (from `.env.example`), `wgw-content/db.sqlite`, the `admin` user (password `storybook-dev`, overridable via `WGW_DEV_USERNAME` / `WGW_DEV_PASSWORD`), JWT keys under `apps/wegotworkspace/wgw-content/keys/` (gitignored), and hundreds of sample calendar events on admin's `default` / `home` / `work` calendars. OpenAPI typegen watch runs alongside. Existing local installs get the same events on the next `pnpm dev` (skip if already present). Re-seed with `php packages/api/artisan wgw:calendars:seed-dev` (`--force` recreates). The seeder refuses `APP_ENV` other than `local`/`testing`, `WGW_INSTALL_CHANNEL` of `docker` or `zip`, and any tree without a parent `pnpm-workspace.yaml`, so production, Docker-channel, and ZIP-extract installs stay empty.

## Docker API (optional)

```bash
pnpm docker:up
pnpm dev          # UI only needs API on :9080; host PHP is not started if you skip `pnpm dev:api`
```

Or run Storybook alone: `pnpm dev:storybook`.

HTTPS / WebDAV hostname: [`docker/README.md`](../docker/README.md).

## Host PHP instead of Docker

```bash
pnpm dev          # API :9080 + Vite app :5173 + Storybook :6006 + typegen watch
pnpm dev:api      # API only
pnpm dev:storybook # Storybook only
pnpm dev:ui       # alias for `pnpm dev`
```

Host API uses PHP’s built-in server on **http://127.0.0.1:9080** (`packages/api` → `dev:php` via install shell `apps/wegotworkspace/index.php`).

**First-time host API setup** (once per clone):

```bash
cp packages/api/.env.example packages/api/.env
php artisan key:generate --working-dir packages/api
bash packages/api/scripts/generate-jwt-keys.sh
# Ensure packages/api/.env has WGW_API_JWT_*_PATH (see .env.example)
pnpm dev:api
curl -s http://127.0.0.1:9080/api/v1/health
```

JWT keys live in `packages/api/storage/app/jwt/` (gitignored) when using `generate-jwt-keys.sh`. `pnpm dev` / `pnpm preview` bootstrap also creates install-tree keys under `wgw-content/keys/`. See [`env.md`](env.md) and [`packages/api/docs/api-auth.md`](../packages/api/docs/api-auth.md).

## Preview (built UI, no HMR)

```bash
pnpm preview
```

Builds apps (`vite build`), starts host PHP API on `:9080`, and serves the bundle via `vite preview` on **http://127.0.0.1:4173** with the same `/api/v1` proxy. Use this to exercise the PWA/service worker and offline contacts against a host API.

Manual split (same result as `pnpm preview` without turbo):

```bash
pnpm dev:api   # terminal 1 → http://127.0.0.1:9080 (health: curl -s http://127.0.0.1:9080/api/v1/health)
cp packages/apps/.env.example .env.local   # once; set VITE_WGW_DEV_* credentials
pnpm --filter @wgw/apps run build && pnpm --filter @wgw/apps run preview   # terminal 2 → :4173
```

- Browser loads **http://127.0.0.1:4173**; `wgwFetch` uses relative **`/api/v1`** (`VITE_WGW_API_BASE_URL` in `.env.local`).
- Vite preview proxies **`/api/v1` → `WGW_PROXY_TARGET`** (default **`http://127.0.0.1:9080`**).

`preview:bootstrap` runs the same `wgw:dev-install` step as `pnpm dev` (see above). To regenerate keys only:

```bash
php packages/api/artisan wgw:jwt-keys
```

To re-run the full dev bootstrap manually:

```bash
php packages/api/artisan wgw:dev-install
php packages/api/artisan wgw:calendars:seed-dev   # optional; also runs from wgw:dev-install
```

See [`packages/api/docs/api-auth.md`](../packages/api/docs/api-auth.md) for env overrides (`WGW_API_JWT_*`).

**Login (`POST /api/v1/auth/token`) prerequisites:**

1. **API running** — `pnpm dev:api` in a separate terminal; `curl -s http://127.0.0.1:9080/api/v1/health` must return `200`.
2. **Laravel env** — `cp packages/api/.env.example packages/api/.env` and `php artisan key:generate --working-dir packages/api`.
3. **Install data** under `apps/wegotworkspace/` — `packages/api/.env` with `WGW_*`, `wgw-content/db.sqlite`, and `wgw-content/keys/api-jwt-{private,public}.pem` (created by the web installer, or copy from an existing install / run `tools/setup-storybook-live-api.sh` after install).
4. **Preview env** — repo-root `.env.local` from `packages/apps/.env.example` with `VITE_WGW_USE_LIVE_API=1` and credentials matching your install user.

If the API is down, the preview proxy returns **502** with `code: proxy_backend_down` (not a Laravel 500). When the API is up but JWT keys are missing, `/auth/token` returns **503** `config_error`.

## Environment files

See [`env.md`](env.md) — root `.env` (tooling), `packages/api/.env` (Laravel), `.env.local` (Vite / Storybook proxy).

### Multiple worktrees (port conflicts)

Default ports are **5173** (app), **6006** (Storybook), **9080** (API), and **4173** (`pnpm preview`). `pnpm dev` picks the next free port in each range when a default is already bound, and prints the URLs.

To pin ports (parallel agents, bookmarks), set them in **`.env.local`** (copy from `packages/apps/.env.example`):

```bash
# Example: second git worktree on the same machine
WGW_VITE_DEV_PORT=5174
WGW_VITE_PREVIEW_PORT=4174
WGW_STORYBOOK_PORT=6007
WGW_PHP_DEV_PORT=9081
```

Restart `pnpm dev` or `pnpm preview` after changing ports. Single-worktree setups can omit these — defaults stay `:5173` / `:6006` / `:9080` / `:4173` when those ports are free.

**Edit the same worktree you run `pnpm dev` in.** Git worktrees share history but not working files — each clone has its own `packages/apps/src/`. Saving in one worktree does not affect Vite running in another.

## UI smoke e2e (Playwright, optional)

Phase 1 loads mock-tier Storybook stories — no live API required:

```bash
pnpm test:apps-e2e
```

Starts Storybook on **:6006** (or reuses `pnpm dev`). Specs live in `packages/apps/e2e/`. With Storybook already running:

```bash
WGW_APPS_E2E_NO_SERVER=1 pnpm test:apps-e2e
```

Not part of `pnpm test:apps-done-gate` or CI yet (see [apps-done-gate.md](../.agents/skills/testing/apps-done-gate.md)).

## Mental model

- **`packages/*`** = where you edit.
- **`apps/wegotworkspace`** = install shell (config + data + front door), not a second API codebase.

## Architecture docs

Cross-cutting product/protocol decisions live under [`docs/architecture/`](architecture/). Start with [Tasks module](architecture/tasks.md) ([#330](https://github.com/WeGotWorkspace/wegotworkspace/issues/330)) for v0.9 Calendar/Tasks work. API conversion detail stays under `packages/api/docs/<domain>/`.
