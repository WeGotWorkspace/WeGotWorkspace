---
name: dev-environment
description: Local dev setup, Docker, Storybook proxy, HTTPS/WebDAV, and troubleshooting for the WeGotWorkspace monorepo. Use when dev servers fail, ports conflict, or live Storybook/API integration breaks.
---

# Dev environment

Canonical layout: [`docs/dev-layout.md`](../../../docs/dev-layout.md). Env files: [`docs/env.md`](../../../docs/env.md). Docker detail: [`docker/README.md`](../../../docker/README.md).

## Multiple worktrees (parallel agents)

When several chunks run `pnpm dev` on one machine, each worktree needs distinct Vite ports. Prefer [`tools/worktree-agent.sh`](../../../tools/worktree-agent.sh):

```bash
tools/worktree-agent.sh create <chunk-id> --port-offset 1   # second worktree → :5174 / :4174
tools/worktree-agent.sh list
```

Manual alternative: copy `packages/apps/.env.example` → `.env.local` and set `WGW_VITE_DEV_PORT` / `WGW_VITE_PREVIEW_PORT`. Details: [dev-layout.md](../../../docs/dev-layout.md#multiple-worktrees-port-conflicts).

## Default workflow (Docker-free)

```bash
pnpm dev                # API :9080 + Vite app :5173 + Storybook :6006
```

| Service | URL | Notes |
|---------|-----|-------|
| Full app (HMR) | http://127.0.0.1:5173 | Vite dev; proxies `/api/v1` → `:9080` |
| Storybook | http://127.0.0.1:6006 | Same API proxy |
| API (host PHP) | http://127.0.0.1:9080 | Health: `/api/v1/health` |
| Built preview | http://127.0.0.1:4173 | `pnpm preview` (no HMR) |
| HTTPS + WebDAV | https://wegotworkspace.localhost/ | Optional — `compose.local.yml` + mkcert |

**Edit paths:** `packages/api` (Laravel), `packages/apps` (UI source). Install shell `apps/wegotworkspace` is config/data only — not a second codebase.

## Docker API (optional)

```bash
pnpm docker:up          # API → http://127.0.0.1:9080
pnpm dev                # UI servers; proxy targets :9080 by default
```

For HTTPS / Sabre endpoints: `pnpm docker:up:https` and set `WGW_PROXY_TARGET=https://wegotworkspace.localhost` in `.env.local` if not using plain HTTP on `:9080`.

## Host PHP (no Docker)

```bash
pnpm dev          # API :9080 + Vite app + Storybook + typegen watch
pnpm dev:api      # API only — Laravel env: packages/api/.env (not repo root)
pnpm dev:storybook # Storybook only
pnpm dev:ui       # alias for `pnpm dev`
pnpm preview      # built UI + API (no HMR)
```

First-time host API JWT (without full install tree): copy `packages/api/.env.example` → `packages/api/.env`, then `bash packages/api/scripts/generate-jwt-keys.sh`. For install-tree keys, `php packages/api/artisan wgw:jwt-keys` (also run by `pnpm dev` / `pnpm preview` bootstrap).

## Offline / PWA (contacts pilot)

`pnpm preview` serves the production build with the same `/api/v1` proxy — use for service worker and offline contacts. Copy `packages/apps/.env.example` → `.env.local` when needed. Details: [`docs/dev-layout.md`](../../../docs/dev-layout.md#preview-built-ui-no-hmr).

## HTTPS + WebDAV (optional)

```bash
brew services stop httpd    # if host Apache binds 80/443
pnpm docker:ssl:setup
docker compose -f compose.dev.yml -f compose.local.yml up -d --build
```

Open **https://wegotworkspace.localhost/** (port 443). Plain HTTP dev API stays on **9080** without `/etc/hosts`.

## After API schema pulls

```bash
docker compose -f compose.dev.yml exec web php /var/www/packages/api/artisan wgw:schema-migrate
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Storybook **`Live …`** stories fail | API not running | `pnpm dev:api` or `pnpm docker:up`; optional `pnpm setup:storybook-live-api`; restart Storybook |
| Full app `/api/v1` errors | API down or wrong proxy | Health at http://127.0.0.1:9080/api/v1/health; check `WGW_PROXY_TARGET` in `.env.local` |
| Preview **500/502** on `/api/v1/*` | API not on `:9080` or proxy backend down | `pnpm dev:api`; `curl http://127.0.0.1:9080/api/v1/health`; match `WGW_PROXY_TARGET` in `.env.local` |
| `/auth/token` **503** `config_error` | Missing JWT keys | `php packages/api/artisan wgw:jwt-keys` or `bash packages/api/scripts/generate-jwt-keys.sh`; set `WGW_API_JWT_*_PATH` in `packages/api/.env` — see `packages/api/docs/api-auth.md` |
| `/auth/token` **401** | Wrong password | Match install user; optional `pnpm setup:storybook-live-api --set-password` |
| Mock-tier stories fail | Unrelated to API — check story mocks | Use `@/lib/api/mock/*-bootstrap`; see [storybook/offline-first.md](../storybook/offline-first.md) |
| `9080` connection refused | API not started | `pnpm dev:api` or `docker compose -f compose.dev.yml up -d --build` |
| `9080` still in use after stopping dev | Orphan `php -S` from a crashed session | `lsof -nP -iTCP:9080 -sTCP:LISTEN` then stop the PID; normal Ctrl+C on `pnpm dev` / `pnpm preview` should release the port |
| `5173` / `4173` port in use | Another worktree or dev server | Set `WGW_VITE_DEV_PORT` / `WGW_VITE_PREVIEW_PORT` in `.env.local` (e.g. `5174` / `4174`); see [dev-layout.md](../../../docs/dev-layout.md#multiple-worktrees-port-conflicts) |
| `6006` port in use | Another Storybook | Stop conflicting process or free the port |
| HTTPS-only Docker without `.env.local` | Default proxy is `:9080` | Set `WGW_PROXY_TARGET=https://wegotworkspace.localhost` for `docker:up:https` |
| HTTPS cert warnings | mkcert not installed | `pnpm docker:ssl:setup`; trust mkcert CA |
| Port 80/443 in use | Host Apache/nginx | `brew services stop httpd` (see docker README) |
| MySQL from container can't reach host DB | `127.0.0.1` is container-local | Use **`host.docker.internal`** as DB host from Docker |
| Login shows **JWT key configuration missing** | No RSA keys under `wgw-content/keys/` | `php packages/api/artisan wgw:jwt-keys` (also run by `pnpm dev` / `pnpm preview` on first start) |
| Login **HTTP 500** on `auth/token` | No `packages/api/.env` (`WGW_*`) / `db.sqlite` (API falls back to empty in-memory DB) | `php packages/api/artisan wgw:dev-install` (also run by `pnpm dev` / `pnpm preview` on first start) |
| Missing tables after pull | Pending WGW migration | `wgw:schema-migrate` (see above) |
| UI edits never appear (HMR or reload) | Editing a **different git worktree** than the one running `pnpm dev` | Open the file under the same clone that started Vite (check `lsof -p $(lsof -t -iTCP:5173) \| grep cwd`). Each worktree has its own `packages/apps/src/` — not symlinked. |
| UI edits on `/` not visible | Component only mounted on app routes (e.g. Contacts at `/contacts/all`) | Navigate to the route that renders the component; `/` is the home launcher only. |
| Type errors after OpenAPI change | Types not regenerated | `pnpm --filter @wgw/api run openapi:build-json` + apps typegen |
| Service worker version jumps every reload (`sw.js` #25104 → #25105) | DevTools **Update on reload** enabled, or `pnpm build` while preview is running | Application → Service Workers → **uncheck “Update on reload”** unless debugging SW updates; avoid rebuilding mid-session — restart `pnpm preview` after a build; optional: Unregister + clear site data to reset stale workers |

## API e2e (local, not default CI for apps)

```bash
pnpm test:api-e2e:docker
```

Uses `compose.ci.yml` — HTTP on `:9080` only.

## Verification before PR

See [developer/done-checklist.md](../developer/done-checklist.md) and `pnpm run ci:quality`.
