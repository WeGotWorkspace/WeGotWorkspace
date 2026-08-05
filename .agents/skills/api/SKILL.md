---
name: api
description: Greenfield Laravel API for packages/api — OpenAPI contract, layering, auth, Flysystem storage, SabreDAV. Use when working on packages/api, REST routes, JWT auth, WebDAV, or API tests.
paths:
  - "packages/api/**"
compatibility: Requires pnpm, Docker (optional), PHP/Laravel toolchain for packages/api.
---

# WeGotWorkspace API

When the user says **greenfield**, **new API**, or work under `packages/api/`:

**Done gate:** `packages/api/docs/api-done-gate.md` · **Contract:** `packages/api/openapi/openapi.json`

## Quick decision matrix

| Task | Read |
|------|------|
| New endpoint / domain | [layers.md](layers.md), [contract-parity.md](contract-parity.md) |
| Route naming / REST layout | [rest-design.md](rest-design.md) |
| Auth / JWT | [auth.md](auth.md) |
| Stack overview | [stack.md](stack.md) |
| File storage / notes / drive | [storage-flysystem.md](storage-flysystem.md) |
| WebDAV | [sabredav.md](sabredav.md) |
| Plugins / activation | [plugins](../plugins/SKILL.md) |
| Meet / room signaling | `packages/api/docs/meet-signaling.md` — or [meet](../meet/SKILL.md) for UI + RTC |
| Tests / done gate | [testing.md](testing.md) |
| Legacy reference | [legacy-reference.md](legacy-reference.md) |

## Definition

Build a **new Laravel application** that matches the **HTTP contract** in OpenAPI.
**There is no legacy PHP in this package.** Do not restore `packages/api/src/` or copy from git history into the tree.

**Contract parity ≠ code parity.** Use OpenAPI + tests; reimplement behavior in Services.

## Required architecture (after Phase 0 scaffold)

- **HTTP:** `routes/api.php` → controllers → Form Requests → API Resources
- **Logic:** `app/Services/{Domain}/` — constructor injection
- **Persistence:** Eloquent models on `wgw` (`app/Models/*` + `UsesWgwConnection`) — not `DB::table()` or raw `\PDO` in domain services (PDO only at documented installer/update/Sabre boundaries; see `packages/api/docs/sql-schema.md`)
- **Config:** Laravel `config/` + `.env` — not legacy `Config::load()` in domain code
- **Auth:** Laravel guard or dedicated JWT service — not legacy bearer + superglobals
- **Tests:** Feature tests per route group before a domain is "done"
- **Files:** Flysystem via `WgwStorage` (see [storage-flysystem.md](storage-flysystem.md))

## Forbidden (migration theater)

- Restoring or referencing `packages/api/src/`, `MailApi`, `*Kernel`, `ApiKernel`, `DomainRouteService`
- Dual autoload (`app/` + `src/`)
- Rename/move legacy folders and keep the same static classes
- `*ApiService` that forwards to deleted legacy code
- `WgwRuntime` / `$_SERVER` shims
- New `*Kernel` / `*Static` / `public static function …(\PDO $pdo)`
- Direct `Paths::data()`, `file_put_contents`, `readfile` in domain code

## SPA shell routes (UiStaticServer allowlist)

Production serves the built SPA via `App\Ui\UiStaticServer`. Paths **not** on its allowlist fall through to **SabreDAV** (WebDAV) — that is how public `/share/:token` links broke after #408 until the prefix was added.

**When adding a top-level client route** (first path segment in `packages/apps/src/wegotworkspace/src/wegotworkspace-routes.tsx`, e.g. `/share`, `/tasks`):

1. Add the prefix to `UiStaticServer::shellRoutePrefixes()` / `spaRoutePrefixes()`
2. Extend `tests/Feature/Front/FrontRoutingTest` (data provider checklist)
3. Confirm `tests/Architecture/SpaShellRouteAllowlistTest` still passes (runs in `composer done-gate` / Architecture suite)

Precedents: `/tasks`, `/share`. This is **not** Playwright e2e — static + feature coverage only. See [.agents/POLICY.md](../../POLICY.md).

## When unsure

Default for REST: **reimplement from OpenAPI.**
If behavior is unclear, ask the user or add a contract test — do not hunt legacy files in the repo.
