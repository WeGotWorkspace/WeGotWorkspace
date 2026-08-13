# Engineering tasks — Calendar API: event item sync + converter parity close-out

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-events-changes` | builder 1 (sequential A→B→C) | api | `packages/api/app/Services/Calendars/CalendarEventRepository.php`, `packages/api/app/Http/Controllers/` (calendars events controller), `packages/api/routes/api.php`, `packages/api/openapi/schemas/calendars/`, `packages/api/tests/Feature/Calendars/` | `composer done-gate` (packages/api) | done |
| `chunk-b-events-set` | builder 1 (sequential A→B→C) | api | new `packages/api/app/Services/Calendars/CalendarEventSetService.php`, `JmapCalendarEventStateService.php`, `packages/api/database/migrations/wgw/` (jmap_calendar_event_states), `CalendarEventMapper.php`, controller + route, OpenAPI schema, feature tests | `composer done-gate` + MySQL parity suite (`phpunit-mysql-parity.xml`) | done (MySQL parity run deferred to chunk-v) |
| `chunk-c-events-query` | builder 1 (sequential A→B→C) | api | `CalendarEventRepository.php` (query), controller + route, `packages/api/openapi/schemas/calendars/`, feature tests | `composer done-gate` | done |
| `chunk-d-converter-closeout` | builder 2 (parallel with builder 1) | api | GitHub issues #138–#145 (evidence-protocol close comments); optional scoped tests in `packages/api/tests/Unit/Calendars/ICalendarJmapEventConverterTest.php`; `packages/api/docs/calendars/ics-jmap-conversion-matrix.md` row verification | `gh issue view <n>` (closed + evidence comment); `composer test` for added tests | done (2026-08-11: issues #138–#145 closed with evidence comments; converter fix + scoped tests landed) |
| `chunk-f-openapi-docs` | builder (after A–D merge) | api, document | `packages/api/openapi/schemas/calendars/`, `packages/api/docs/calendars/jmap-calendars-summary.md`, `packages/api/docs/jmap-rest-parity-gaps.md`, `packages/api/docs/contacts/jmap-sync-rest-mapping.md` | `composer done-gate:contract` | done (also `optimistic-concurrency.md` cross-ref + Fastmail recurrence golden extended with byDay) |
| `chunk-v-verify` | read-only verifier | verify-issue, testing | whole diff vs #429 AC; `.agents/specs/429-calendar-jmap-parity/` drift check | `run_api_done_gate` (wgw-verify MCP; fallback `composer done-gate`); `gh issue view 429 --json body --jq .body \| shasum -a 256` | done (2026-08-11: body-hash SYNC OK; `composer done-gate` PASSED 1099 tests; `test:mysql:parity` PASSED 826 tests on MySQL 8; AC verdict ISSUE_SATISFIED — fix applied: `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` 21→22 for the new state-table migration) |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- A/B/C are **sequential within one agent** — they share `routes/api.php` (calendars group), `CalendarEventRepository`, and `openapi/schemas/calendars/`. D is the only chunk safe to run in a parallel agent.
- Chunk D is **gated** on the audit table in spec.md (complete, 2026-08-11): all eight issues are implemented on `main`; D is close-out plus at most two scoped test items — do not rebuild converters.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update issue #429 first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.

## Close-out notes (2026-08-11)

- **Schema version bump (chunk B):** the done gate forced `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` 21→22 for the new `jmap_calendar_event_states` migration; conceptually part of chunk B even though it was applied during chunk V verification.
- **Verifier nits fixed in this branch:** empty `?since=` now normalizes to `oldState: "0"` in `CalendarEventRepository::changes()` (consistent with `normalizeSyncToken`), and `/calendars/events/changes` documents its 404 response in OpenAPI (mirrors `/calendars/events/query`).
- **Verifier nits accepted (known, no action in this branch):**
  - State rows are keyed uri-globally: the `calendar_uri` column is recorded but unused in lookups.
  - Non-VEVENT object deletions can leak into the events `destroyed` list (JMAP-safe: clients ignore unknown ids).
  - `CalendarEventRepository` has grown large; a query-service extraction is a follow-up.

## RFC 8620 conformance pass (2026-08-12, external JMAP-spec review)

Calendar endpoints reshaped to RFC 8620 core method semantics (calendar frontend does not exist yet, so shapes were free to change):

- `/set` (§5.3): `created` maps creation id → `{id, state}`; `updated` maps id → `{state}`; top-level `oldState`/`newState` (touched-calendar sync state: single calendar → plain synctoken, multiple → `{count}:{uri:token,...}` composite sorted by uri, nothing mutated → all owned VEVENT calendars with `oldState` == `newState`); SetError types camelCase (`notFound`, `invalidProperties` + `properties`, `forbidden`, `serverFail`).
- `/changes` (§5.2): `hasMoreChanges` (always `false`) on both event and collection responses; `maxChanges` validated but never truncates — Sabre's changes-log dedup cannot produce a safe intermediate token (could skip changes), correctness over pagination.
- `/query` (§5.5): `queryState` (same composition over `filter.inCalendars`) + `canCalculateChanges: false`.

**Documented follow-ups (out of scope here):**

- Contacts/tasks `/set`, `/changes`, `/query` still use the legacy shapes (string-valued created/updated maps, snake_case error types, no `hasMoreChanges`/`queryState`) — they have shipped consumers; align in a dedicated change.
- ~~`byMonth`/`byMonthDay` wire types vs RFC 8984 `String[]` (leap-month `"3L"`) — cross-domain converter gap.~~ **Closed for calendars**: `byMonth` is `String[]` (`"3L"` supported), `byDay` is `NDay[]` objects, `byHour`/`byMinute`/`bySecond` added as `UnsignedInt[]`; `byMonthDay` was already correct as `Int[]` per RFC 8984. Tasks (VTODO) share `CalendarConversionSupport::recurrenceRuleFromProperty` and keep the legacy shapes via `legacyWireTypes: true` (shipped consumers) — task-domain alignment remains a follow-up.
- Per-record `ifInState` on `/set` update/destroy entries is a **deliberate divergence** from RFC's request-level `ifInState` (item state tokens are per event) — kept, documented in OpenAPI + `docs/jmap-rest-parity-gaps.md`.
