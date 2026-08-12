# Tasks — JMAP transport envelope (calendars)

Engineering split per [plan.md](./plan.md). Branch: `feat/jmap-envelope-calendars` (stacked on `feat/calendar-jmap-parity`).

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| chunk-a-jmap-session | builder | api | `app/Http/Controllers/Api/V1/Jmap/JmapSessionController.php`, `routes/api.php`, `tests/Feature/Jmap/JmapSessionTest.php` | `composer done-gate` + field-by-field diff vs client `core/types.ts` (quoted in spec §Ground-truth contracts) | done |
| chunk-b-jmap-dispatcher | builder | api | `app/Http/Controllers/Api/V1/Jmap/JmapApiController.php`, `app/Services/Jmap/JmapMethodDispatcher.php`, `app/Services/Jmap/JmapAccountStateCodec.php`, `tests/Feature/Jmap/JmapDispatcherTest.php`, `tests/Unit/Jmap/JmapAccountStateCodecTest.php` | `composer done-gate`; codec round-trip empty/single/multi | done |
| chunk-c-jmap-get-query | builder | api | `app/Services/Jmap/Methods/*`, `tests/Feature/Jmap/JmapCalendarMethodsTest.php` | `composer done-gate` | done |
| chunk-d-jmap-changes | builder | api | `app/Services/Jmap/Methods/*Changes*`, `tests/Feature/Jmap/JmapChangesTest.php` | `composer done-gate`; 4 named fan-out branch tests + metadata-caveat test | done |
| chunk-e-jmap-set | builder | api | `app/Services/Jmap/Methods/CalendarEventSetMethod.php`, `tests/Feature/Jmap/JmapEventSetTest.php` | `composer done-gate`; stateMismatch asserts no mutation; newState decomposable | done |
| chunk-f-jmap-client-verify | builder | api, testing | `tests/Feature/Jmap/JmapClientContractTest.php` | option (b) — backend contract tests replicating the shipped client's exact call sequences (lit-calendar repo unavailable in build env; spec-quoted types are the verified oracle); mismatch-13 regression covered | done |
| chunk-g-jmap-docs | builder | api, document | `docs/calendars/jmap-envelope.md`, `docs/calendars/jmap-calendars-summary.md`, `docs/jmap-rest-parity-gaps.md` | doc review | done |

## Notes

- Chunk F deviation from plan.md: option (a) (live unmodified-client integration run) requires the `lit-calendar` repo, which is not present in the build environment. Option (b) is implemented backend-side from the spec's verbatim-quoted, independently re-verified client contracts. Run option (a) locally before merge if possible.
- Amendment (review 2026-08-13): `Calendar/changes` via synctoken diff may miss pure metadata updates (rename/color) if Sabre does not bump `synctoken` on `calendarinstances` changes — chunk D must pin actual behavior with a test; chunk G documents the outcome.
- Amendment outcome (chunk D, empirical): Sabre **does** bump the synctoken on pure metadata updates, so renames/recolors are reported as `updated` (pinned in `JmapChangesTest`). Side discovery: Sabre logs the metadata change with an empty object uri, which leaked a phantom empty event id into `/changes` — fixed in `CalendarEventRepository` (REST path too) with a regression test in `CalendarsEventsSyncTest`.
