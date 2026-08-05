# API done gate

Use this checklist before calling a greenfield API slice **done** or merging substantial `packages/api` work.

## One command

From the repo root:

```bash
pnpm test:api-done-gate
```

Full CI-quality stack (typegen drift, ESLint, Prettier/Pint, `tsc`, API done gate):

```bash
pnpm run ci:quality
```

Or inside `packages/api`:

```bash
composer done-gate
```

This runs, in order:

1. **`greenfield:guard`** — no legacy patterns in `app/` (Flysystem, no `*Kernel`, etc.)
2. **Architecture tests** — bidirectional OpenAPI ↔ routes (`OpenApiRouteContractTest`) + guard smoke
3. **Full PHPUnit** — unit, feature, and storage suites

Faster check (contract only, no feature suite):

```bash
composer done-gate:contract
```

CI runs the full gate (see `.github/workflows/ci.yml`).

## Reading the output

`composer done-gate` prints labeled steps and a final summary. **Exit code 0 = passed.**

PHPUnit may still print **"OK, but there were issues!"** — that means **deprecations**, not failing tests:

| Signal | Meaning |
|--------|---------|
| `.` | Test passed |
| `D` | Test passed but triggered a deprecation (details listed after the run) |
| `F` / `E` | Failure / error — gate should exit non-zero |

Common deprecations today:

- **PHPUnit metadata** — prefer `#[DataProvider]` attributes over `@dataProvider` docblocks.

More detail on demand:

```bash
composer done-gate -- --verbose          # testdox names on full suite
DONE_GATE_VERBOSE=1 composer done-gate
php vendor/bin/phpunit --display-deprecations --display-phpunit-deprecations
```

## What each layer means

| Layer | Enforces |
|-------|----------|
| **OpenAPI ↔ routes** | Every `routes/api.php` `/api/v1/*` route is in `openapi/openapi.json`, and every documented operation has a Laravel route (`OpenApiRouteContractTest`). |
| **SPA shell allowlist** | Every top-level path in `wegotworkspace-routes.tsx` is on `UiStaticServer::spaRoutePrefixes()` (`SpaShellRouteAllowlistTest`). Feature checklist: `FrontRoutingTest`. |
| **Feature tests** | Behavior for the domain you touched (happy path + main errors). Add or extend tests under `tests/Feature/{Domain}/`. |
| **greenfield-guard** | Implementation style: Services, Eloquent, `WgwStorage` — not legacy shims or raw file I/O in the wrong layers. |

**Contract parity ≠ code parity.** The spec is the HTTP contract; reimplement logic in Laravel Services. Do not copy deleted `packages/api/src/`.

## When implementing an endpoint

1. Edit **`openapi/openapi.json`** first (path + method + schemas).
2. Add route → Form Request → Resource → Service.
3. Add **`tests/Feature/...`** coverage (**write or extend failing tests before implementation** — see [`.agents/skills/testing/test-first.md`](../../../.agents/skills/testing/test-first.md)).
4. Run **`composer done-gate`** (or at least Architecture + your feature tests).

Regenerate types when the spec changes:

```bash
pnpm --filter @wgw/api run openapi:build-json   # sync paths into openapi.built.json
pnpm --filter @wgw/api run typegen
pnpm --filter @wgw/api run openapi:check-drift  # fail if built JSON still stale vs source
```

## Out of scope for this gate

- **WebDAV / UI** (`routes/web.php`, Sabre, static shells) — separate smoke/e2e paths.
- **Playwright API e2e** — `pnpm test:api-e2e:docker` locally after the gate (not run in CI).
- **OpenAPI TypeScript drift** — `pnpm check:api-types` in CI.

## Definition of done (whole REST API)

- `composer done-gate` green
- `pnpm check:api-types` green
- No `packages/api/src/` or `packages/api/legacy/` in the tree
- Feature coverage per OpenAPI tag is acceptable for production (ongoing; gate does not count tests per tag yet)
