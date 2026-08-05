# API testing (PHPUnit)

## Gate

A domain is **not done** until feature tests pass for its routes without calling legacy handlers, and **`composer greenfield:guard`** passes.

## Required

- Feature test per controller/route (status + JSON vs OpenAPI / captured fixtures)
- Unit tests for services and non-trivial repositories
- Database-backed tests extend **`Tests\Support\WgwDatabaseTestCase`** (Laravel `RefreshDatabase` on the `wgw` connection)
- Factories in `database/factories/` (`UserFactory`, `PrincipalFactory`, `GroupMemberFactory`, `AppSettingFactory`)
- `SeedsWgwIdentity` on `WgwDatabaseTestCase` (`seedWgwUser()`, `seedWgwGroup()`, `addPrincipalToGroup()`) — avoid hardcoded IDs
- `ConfiguresAppSettings` on `WgwDatabaseTestCase` (`setAppSetting()`, `setAppSettings()`)
- File features: `Storage::fake('wgw_files')` / `wgw_notes` — no manual `$tmpDir` unless configuring fake disk root

## `WgwDatabaseTestCase`

Most API and model tests extend `tests/Support/WgwDatabaseTestCase.php`:

- Runs `migrate:fresh` **once** against `database/migrations/wgw` on connection `wgw`
- Wraps each test in a transaction on `wgw` (rollback between tests)
- Calls `WgwTestDatabase::configureConnection()` so SQLite `:memory:` is the default and `WGW_TEST_DRIVER=mysql` still works
- Mixes in `InteractsWithWgwBearerTokens` for JWT helpers (`issueBearerToken()`, `issueBearerTokenFor()`, `withBearer()`, `bearerHeaders()`)

PHPUnit sets `DB_CONNECTION=wgw` and `WGW_DB_DATABASE=:memory:` in `phpunit.xml`.

## CI tiers (tiered MySQL strategy)

DB tests run on SQLite by default and on MySQL via `WGW_TEST_DRIVER=mysql`. CI splits MySQL coverage into a fast PR tier and a full safety net:

| Tier | Trigger | Command | Scope |
|------|---------|---------|-------|
| SQLite full | every PR / push (`api-quality`) | `composer done-gate` | entire suite on SQLite |
| MySQL parity subset | every PR / push (`api-mysql`) | `composer test:mysql:parity` | `MySQLParity` testsuite (~525 tests) on MySQL |
| MySQL full | `main` push + nightly cron (`ci-mysql-full.yml`) | `composer test:mysql` | entire suite on MySQL |

`MySQLParity` is a dedicated `<testsuite>` in its own config `phpunit-mysql-parity.xml` (class-level `#[Group]` does **not** propagate to `WgwDatabaseTestCase` subclasses in PHPUnit 11, so a testsuite — not a group — is the source of truth; a separate config keeps the overlapping selection out of the default `phpunit.xml` runs, which would otherwise emit "file already added to another suite" warnings). It captures every `WgwDatabaseTestCase` descendant plus `WgwSchemaParityTest` and the installer MySQL install test. New DB-backed feature tests under `tests/Feature` are included automatically; DB-backed tests added elsewhere (e.g. `tests/Unit`) must be added to the `MySQLParity` testsuite, and its `<php>` env block must mirror `phpunit.xml`. Never narrow the SQLite gate or drop full MySQL coverage on main/nightly.

### Parallel sharding (PR wall-clock)

The PR tiers run as 2-leg GitHub Actions matrices (`api-quality` and `api-mysql`, `shard: [1, 2]`) to halve PHPUnit wall-clock. `scripts/phpunit-shard.php` resolves a phpunit config's testsuite files, sorts them, and assigns them round-robin to N shards (so adding tests rebalances automatically; full union with no overlap).

- **`api-quality`** sets `DONE_GATE_SHARD=I/N`. `done-gate.php` reads it: shard 1 still runs greenfield-guard + the Architecture suite, every shard runs its slice of unit/feature/storage. `DONE_GATE_SHARD` is declared in `turbo.json` `passThroughEnv` (Turbo runs in strict env mode and would otherwise strip it). Unset locally → full gate, unchanged.
- **`api-mysql`** sets `WGW_PHPUNIT_SHARD=I/N` and runs `composer test:mysql:parity:shard`, which shards the `MySQLParity` testsuite.
- Branch protection still requires only `build`; it `needs` both quality jobs, and a `needs` on a matrix job waits for all legs. No required-check rename.

**Exceptions** (do not extend `WgwDatabaseTestCase`):

- **Installer** tests — exercise first-run DB creation from an empty install tree
- **Migrator** tests — seed legacy schema versions and assert incremental upgrades
- Pure unit tests with no database

## Architecture tests

`tests/Architecture/GreenfieldArchitectureTest.php` and `scripts/greenfield-guard.php` enforce:

- No legacy handlers, `Paths`, or raw file I/O in domain layers
- Domain services do not use `DB::connection('wgw')->table()`
- All `app/Models/*.php` use `UsesWgwConnection`
- No runtime `ALTER TABLE` DDL in domain services

`tests/Architecture/SpaShellRouteAllowlistTest.php` enforces that every top-level path in `wegotworkspace-routes.tsx` appears on `UiStaticServer::spaRoutePrefixes()`. Feature checklist: `FrontRoutingTest`. When adding `/share`-style routes, update both — see [api/SKILL.md](SKILL.md) § SPA shell routes. This is not Playwright e2e.

## Mail

Assert `{ error, message }` shape where contract requires it.
