# @wgw/api — OpenAPI contract + Laravel REST API

Greenfield Laravel app for `/api/v1/*`, plus the **OpenAPI contract** and generated TypeScript types for the UI. Legacy `packages/api/src/` is gone — implement against `openapi/openapi.json` only.

## Layout

| Path | Purpose |
|------|---------|
| `openapi/openapi.json` | Source of truth for paths, methods, request/response shapes |
| `openapi/generated/*` | Generated TS types + `openapi.built.json` (committed) |
| `scripts/*` | OpenAPI build + typegen only |
| `docs/api-done-gate.md` | Definition of done (guard, OpenAPI parity, PHPUnit) |

## Commands

```bash
composer --working-dir packages/api test      # PHPUnit (phases 0–4)
pnpm test:api-done-gate                       # greenfield guard + OpenAPI contract + PHPUnit
pnpm --filter @wgw/api test:e2e               # Playwright smoke (health + meet always; install wizard skips if already installed)
pnpm test:api-e2e:docker                      # full e2e against Docker with fresh install tree
pnpm --filter @wgw/api typegen                # sync openapi.built.json from openapi.json, then regenerate TS types
pnpm --filter @wgw/api typegen:check          # fail if generated files are stale
pnpm seed                                     # local-dev calendars + notes (wgw:seed-dev; also from wgw:dev-install)
pnpm seed:notes                               # ~1000 VJOURNAL notes only (wgw:notes:seed-dev --force to recreate)
```

Dev seeders write into the CalDAV store for the admin user and refuse production / Docker-channel / ZIP extracts. See [`docs/dev-layout.md`](../../docs/dev-layout.md).

**PHP:** `^8.3` (CI uses 8.3). PHP 8.5 is fine locally; API responses suppress deprecation display so `/api/v1/*` stays clean JSON.

`openapi/openapi.json` is the hand-edited spec (Swagger UI and route parity). `openapi/generated/openapi.built.json` syncs paths from source and keeps enriched schemas for typegen (committed). After editing `openapi.json`, run `pnpm --filter @wgw/api run typegen` in the same change; `openapi:check-drift` and `typegen:check` fail CI when built output is stale.

## Implementing the API

Implement and extend the Laravel app under `packages/api/` against `openapi/openapi.json`. Follow `.agents/skills/api/` and `docs/api-done-gate.md`.

Do not restore `packages/api/src/` into this tree.
