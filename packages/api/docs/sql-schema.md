# Database schema (installer-owned)

Greenfield Laravel code uses **Eloquent models** on the **`wgw`** connection. Domain `Services` must not call `DB::connection('wgw')->table()` — use `app/Models/*` instead.

## Source of truth

Product schema is defined in **`database/migrations/wgw/`** and applied by `WgwSchemaMigrator` during:

- Fresh install (`InstallerDatabaseInstaller`)
- In-place updates (`UpdateRunner` → `running_migrations` step)

Sabre Cal/Card/Locks/PropertyStorage tables are still loaded from driver-specific SQL bundles under `resources/installer/sql/{sqlite,mysql}/` inside migration `2026_06_06_000030_wgw_apply_sabre_sql_bundles.php` until fully ported to Blueprint.

Legacy `app_migrations` (versions 1–9) remains on upgraded installs as audit history; active tracking uses Laravel's `migrations` table on the `wgw` connection.

## Eloquent models

All models use [`UsesWgwConnection`](app/Models/Concerns/UsesWgwConnection.php) (`getConnectionName(): 'wgw'`).

| Table | Model | Notes |
|-------|--------|--------|
| `users` | `App\Models\User` | Sabre HTTP Basic (`digest` bcrypt) |
| `principals` | `App\Models\Principal` | DAV principals, profile `email` / `displayname` |
| `groupmembers` | `App\Models\GroupMember` | Group membership join |
| `app_settings` | `App\Models\AppSetting` | Key/value site settings (string PK `name`) |
| `api_refresh_tokens` | `App\Models\ApiRefreshToken` | JWT refresh tokens (`token_hash` PK) |
| `api_password_reset_tokens` | `App\Models\ApiPasswordResetToken` | Hashed one-time password-reset tokens (`token_hash` PK) |
| `api_revoked_tokens` | `App\Models\ApiRevokedToken` | Revoked JWT JTIs |
| `app_update_history` | `App\Models\AppUpdateHistory` | In-place update audit log |
| `app_migrations` | `App\Models\AppMigration` | Legacy schema version audit (upgraded installs) |
| `meet_peers` | `App\Models\MeetPeer` | Meet signaling peers (composite key) |
| `meet_messages` | `App\Models\MeetMessage` | Meet signaling messages |
| `collab_peers` | `App\Models\CollabPeer` | Collab signaling peers |
| `collab_messages` | `App\Models\CollabMessage` | Collab signaling messages |
| `search_documents` | `App\Models\SearchDocument` | Unified search index documents |
| `search_terms` | `App\Models\SearchTerm` | Search token weights (FK → `search_documents`) |
| `drive_starred_items` | `App\Models\DriveStarredItem` | Per-user starred drive paths |
| `calendar_rsvp_tokens` | `App\Models\CalendarRsvpToken` | Public iMIP RSVP tokens (`token_hash` SHA-256, event uid + attendee mailto + expiry) |
| `calendar_subscriptions` | `App\Models\CalendarSubscription` | Live ICS/webcal subscriptions (owner username + personal calendar uri + normalized source URL) |
| `calendar_feed_tokens` | `App\Models\CalendarFeedToken` | Published ICS/webcal feed tokens (`token_hash` SHA-256; `token_cipher` Laravel-encrypted with APP_KEY so the owner URL can be re-shown — not hash-only like RSVP) |
| `calendar_share_dismissals` | `App\Models\CalendarShareDismissal` | Per-user hide of an inbound ACL share (`username` + Sabre `calendarid`). Owner `shareWith` is unchanged; restore deletes the row. |
| `calendarobjects` | `App\Models\CalendarObject` | CalDAV objects (`VEVENT`/`VTODO` blobs; Calendars REST + Tasks REST; search indexer) |
| `calendars` | `App\Models\Calendar` | CalDAV calendar collection root (`components` includes `VTODO` for task lists) |
| `calendarinstances` | `App\Models\CalendarInstance` | Per-principal calendar instances (Calendars REST reads; Tasks REST `TaskList.id` = instance `uri`) |
| `cards` | `App\Models\Card` | CardDAV vCards (search indexer joins) |
| `addressbooks` | `App\Models\Addressbook` | CardDAV address books (Contacts REST reads) |
| `mail_user_credentials` | `App\Models\MailUserCredential` | Per-user IMAP/SMTP credentials |

Sabre-owned tables (`locks`, `propertystorage`, `calendarchanges`, …) have no app models yet; access them through Sabre backends or add models when a domain needs direct queries.

## PDO exception boundaries

`\PDO` / `getPdo()` is allowed only for **SabreDAV** and **update SQL backup dumps**:

| Area | Why PDO remains |
|------|-----------------|
| `InstallerSeeder` (Sabre Cal/Card init) | Sabre `CalPDO` / `CardPDO` backends require `\PDO` |
| `UpdateRunner::backupDatabase()` | Table-by-table SQL dump during in-place update backup |
| `Services/Settings/GroupDirectoryService` | Sabre `PrincipalBackend` |
| `Services/Admin/AdminUserProvisionerService` | Sabre Cal/Card teardown on user delete |
| `Services/Auth/SabreCredentialValidator` | Sabre `PDOBasicAuth` |
| `Dav/SabreServerFactory` | Sabre server PDO bridge |
| `WgwConnectionConfigurator::applyFromPdo()` | Unit-test bridge for legacy schema fixtures only |

Installer connectivity, user probes, and install readiness use `WgwDatabaseProbe` (`DB` + Eloquent on `wgw`).

## Connection

`config/database.php` `connections.wgw` is populated from `WGW_DB_*` in `packages/api/.env` at boot (`WgwServiceProvider`). Prefer models with `UsesWgwConnection`; use `DB::connection('wgw')` only when Eloquent is not practical (migrations, installer cutover).

## Adding a table

1. Add a migration under `database/migrations/wgw/` using `WgwMigration` + `Schema::hasTable()` guards.
2. Bump `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` to the new `database/migrations/wgw/` file count, and extend that migrator test’s expected-table list.
3. Add `app/Models/{Name}.php` with `UsesWgwConnection` and documented `$fillable`.
4. Use the model from `app/Services/{Domain}/` — no `DB::table()`.
5. Extend `tests/Architecture/WgwSchemaParityTest.php` expected table list.
6. Add a feature or database test on `WgwDatabaseTestCase` (SQLite). MySQL parity is covered automatically — every `WgwDatabaseTestCase` descendant is part of the `MySQLParity` testsuite that CI runs against MySQL (see Tests → CI tiers below).

## Tests

- **Harness:** `WgwDatabaseTestCase` + `WgwTestDatabase` run `migrate:fresh` on `database/migrations/wgw/` (replaces hand-rolled `SqliteWgwSchema`).
- **Drivers:** default SQLite (`:memory:`); set `WGW_TEST_DRIVER=mysql` with `WGW_TEST_MYSQL_*` env vars for MySQL.
- **CI tiers (tiered MySQL strategy):**
  - **PR / push — SQLite (full):** `api-quality` runs `composer done-gate` over the entire suite on SQLite.
  - **PR / push — MySQL (parity subset):** `api-mysql` runs `composer test:mysql:parity` — the `MySQLParity` testsuite (every `WgwDatabaseTestCase` descendant + `WgwSchemaParityTest` + the installer MySQL install test, ~525 tests). This catches DB-dialect regressions without running all ~789 tests twice on every PR.
  - **main / nightly — MySQL (full):** `.github/workflows/ci-mysql-full.yml` runs `composer test:mysql` (the entire suite on MySQL) on pushes to `main` and on a nightly cron. This is the full MySQL safety net.
  - Local full stack: `composer done-gate:full` (SQLite suite + full MySQL driver run).
  - **Parallel shards:** both PR tiers run as 2-leg matrices (`shard: [1, 2]`) to cut wall-clock; `scripts/phpunit-shard.php` splits the testsuite files round-robin. `api-quality` passes `DONE_GATE_SHARD=I/N` (shard 1 keeps guard + Architecture); `api-mysql` passes `WGW_PHPUNIT_SHARD=I/N` via `composer test:mysql:parity:shard`. Unset locally → full gate, unchanged.
- **`MySQLParity` testsuite:** defined in its own config `phpunit-mysql-parity.xml` (kept separate from `phpunit.xml` so the default `composer test`/done-gate runs don't emit "file already added to another suite" warnings for the overlapping selection). It includes `tests/Feature` (minus the non-DB `Front`, `System`, `Ui` groups), `tests/Database`, the three DB-backed `tests/Unit` cases, and `tests/Architecture/{WgwSchemaParityTest,RoleAccessMatrixTest}`. New DB-backed feature tests are picked up automatically; DB-backed tests added elsewhere should be added to the testsuite. The `<php>` env block must mirror `phpunit.xml`.
- **Parity:** `tests/Architecture/WgwSchemaParityTest.php` asserts expected tables per driver.
- **Architecture:** `tests/Architecture/GreenfieldArchitectureTest.php` + `scripts/greenfield-guard.php`.
- **Cutover:** `tests/Unit/Installer/WgwSchemaMigratorTest.php` covers fresh migrate, idempotency, and legacy `app_migrations` v0–5.
