# Laravel API — OpenAPI contract + REST

Greenfield Laravel app for `/api/v1/*`, plus the hand-edited **OpenAPI contract**. Generated TypeScript lives in `packages/openapi-types` (`@wgw/openapi-types`). This directory is Composer-only: it is not a pnpm workspace package. Legacy `packages/api/src/` is gone — implement against `openapi/openapi.json` only.

## Layout

| Path | Purpose |
|------|---------|
| `openapi/openapi.json` | Source of truth for paths, methods, request/response shapes |
| `openapi/schemas/` | Modular schema fragments merged into the typegen document |
| `docs/api-done-gate.md` | Definition of done (guard, OpenAPI parity, PHPUnit) |
| `packages/openapi-types/generated/` | Generated TS types + committed `openapi.built.json` |

## Commands

```bash
composer --working-dir packages/api test      # PHPUnit
pnpm test:api-done-gate                       # greenfield guard + OpenAPI contract + PHPUnit
pnpm test:api-e2e                             # Playwright smoke (health + meet always; install wizard skips if already installed)
pnpm test:api-e2e:docker                      # full e2e against Docker with fresh install tree
pnpm --filter @wgw/openapi-types typegen      # merge openapi.built.json, then regenerate TS types
pnpm --filter @wgw/openapi-types typegen:check
pnpm seed                                     # local-dev calendars + notes + contacts (wgw:seed-dev; also from wgw:dev-install)
pnpm seed:notes                               # ~1000 VJOURNAL notes only (wgw:notes:seed-dev --force to recreate)
pnpm seed:calendars                           # sample calendar events only
pnpm seed:contacts                            # 1000 vCard contacts (wgw:contacts:seed-dev --profile=large or --count=; --force recreates)
```

Dev seeders write into the CalDAV store for the admin user and refuse production / Docker-channel / ZIP extracts. Contacts land in the personal book only (group books are not seeded) and are not added to the search index; reindex with `POST /api/v1/admin/search/jobs`. See [`docs/dev-layout.md`](../../docs/dev-layout.md).

**PHP:** `^8.3` (CI uses 8.3). PHP 8.5 is fine locally; API responses suppress deprecation display so `/api/v1/*` stays clean JSON.

`openapi/openapi.json` is the hand-edited spec (Swagger UI and route parity). Typegen loads the committed `packages/openapi-types/generated/openapi.built.json` and overlays source paths plus `openapi/schemas/`. It does **not** delete keys you removed from the source: a dropped path or schema stays in the built file and in the generated types until that follow-up lands (one committed spec, built file generated from it alone). After editing `openapi.json` or `schemas/`, run `pnpm --filter @wgw/openapi-types typegen` in the same change. `typegen:check` fails CI when generated output is stale.

## Implementing the API

Implement and extend the Laravel app under `packages/api/` against `openapi/openapi.json`. Follow `.agents/skills/api/` and `docs/api-done-gate.md`.

Do not restore `packages/api/src/` into this tree.
