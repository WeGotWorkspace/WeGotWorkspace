# API layers (`packages/api`)

## Controllers (`app/Http/Controllers/Api/V1/`)

- Invokable or single-action controllers; inject services
- No business logic, no `\PDO`, no `Config::load()`

## Form Requests (`app/Http/Requests/Api/V1/`)

- All input validation; services receive `$request->validated()` only

## API Resources (`app/Http/Resources/Api/V1/`)

- Success JSON; keys match OpenAPI / parity tests exactly

## Services (`app/Services/{Domain}/`)

- Instance methods, constructor injection
- Return DTOs, models, or arrays — never `Response` / `JsonResponse` / `ApiResult` at the controller boundary use Resources instead
- Persist via Eloquent models — not `DB::connection('wgw')->table()` and not runtime DDL (`ALTER TABLE`)
- `\PDO` / `getPdo()` only in documented boundaries (installer connect, update backup, Sabre backends) — see `packages/api/docs/sql-schema.md`

## Models (`app/Models/`)

- Eloquent for all app-owned `wgw` tables; use `UsesWgwConnection` on every model
- Relationships documented where used
- No parallel "repository" that duplicates the model with raw SQL unless querying is genuinely complex

## Storage (`app/Storage/`)

- **`WgwStorage`** (or equivalent): single entry for Flysystem disks — see [storage-flysystem.md](storage-flysystem.md)
- Path normalization + ACL live in `app/Storage/` (or `app/Services/Storage/`), not per-domain copies

## Repositories (`app/Repositories/`)

- Optional, for heavy DB queries
- Must not accept `\PDO` from `WgwDatabase` — use models or `DB::connection('wgw')`
- Must not use `Paths::` or raw PHP file functions — inject `WgwStorage` for any file persistence (drive metadata files, migration-source trees, etc.)
