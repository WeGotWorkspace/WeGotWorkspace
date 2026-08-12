# Calendar API: event item sync + converter parity close-out

Derived from [spec.md](./spec.md). Delivery issue: [#429](https://github.com/WeGotWorkspace/wegotworkspace/issues/429) (parent epic #137).

## Goal

Item-level offline sync for calendar events (`/changes`, `/set` with `ifInState`, `/query`) mirroring the contacts implementation, plus evidence-protocol close-out of converter parity issues #138–#145 (audit in spec.md: all implemented on `main`).

## Non-goals

- Frontend work; calendar sharing (#157); recurrence expansion beyond `expandRecurrences`; full JMAP envelope — see [spec.md](./spec.md#non-goals)

## Affected packages

- packages/api

## Dependencies

1. Chunk 0 (this spec + audit + composite-id decision) — **done**
2. Chunks A → B → C **sequential within one agent**: they share the calendars route group (`routes/api.php`), `CalendarEventRepository`, and the `openapi/schemas/calendars/` files; parallel agents would conflict on every commit
3. Chunk D is parallel-safe alongside A/B/C (touches only converter tests/docs and GitHub issues)
4. Chunk F last (documents the shipped state of A–D)
5. Chunk V after everything merges

## Chunks

### Chunk A: GET /calendars/events/changes

- **id:** `chunk-a-events-changes`
- **Skill:** api
- **Inputs:** `ContactCardRepository::changes` / `mapChangeUris` as reference; composite-id decision in [spec.md](./spec.md#composite-id-decision-binding-for-chunks-a-and-c); Sabre `CalPDO::getChangesForCalendar`
- **Done when:** `GET /calendars/events/changes?calendarId=&since=` returns `{oldState,newState,created,updated,destroyed}`; empty/`0` since → all ids in `created`; invalid token → 400 `cannotCalculateChanges`; feature test mirroring `ContactsCardsSyncTest` passes with REST *and* raw CalDAV mutations both surfacing, including a multi-VEVENT object case; OpenAPI schema added
- **Verify with:** `composer done-gate` (packages/api) or `run_api_done_gate` via wgw-verify MCP
- **Parallel with:** D only (B and C wait — same agent, sequential)

### Chunk B: POST /calendars/events/set with ifInState

- **id:** `chunk-b-events-set`
- **Skill:** api
- **Inputs:** `ContactCardSetService`, `JmapContactStateService`, `jmap_contact_states` migration as reference; destroy-expansion contract from the composite-id decision (state rows per emitted event id)
- **Done when:** batch create/update/destroy with per-item `ifInState` → etag If-Match → `stateMismatch`; `jmap_calendar_event_states` migration + state service + state attachment in `CalendarEventMapper`; feature test covers created/updated/destroyed/notCreated/notUpdated/notDestroyed + `stateMismatch`; `/changes` destroy-expansion (Chunk A helper) becomes effective; MySQL parity suite covers the migration
- **Verify with:** `composer done-gate` + `phpunit-mysql-parity.xml` suite
- **Parallel with:** D only (after A in the same agent)

### Chunk C: POST /calendars/events/query

- **id:** `chunk-c-events-query`
- **Skill:** api
- **Inputs:** `POST /tasks/items/query` as reference; per-sub-VEVENT matching rule from the composite-id decision; `calendarobjects.firstoccurence`/`lastoccurence` pre-filter (already used by `SearchIndexerService`)
- **Done when:** filter by calendar ids, time range (`after`/`before`), text match on title; sort + position/limit; feature test passes incl. recurring-event time-range matching and a multi-VEVENT object case; OpenAPI updated
- **Verify with:** `composer done-gate`
- **Parallel with:** D only (after A and B in the same agent)

### Chunk D: Converter parity close-out #138–#145

- **id:** `chunk-d-converter-closeout`
- **Skill:** api
- **Inputs:** audit table in [spec.md](./spec.md#converter-audit--hard-gate-for-chunk-d) — all eight issues implemented on `main`; evidence protocol from the approved plan
- **Done when:** each of #138–#145 closed with a comment stating (a) exact main commit SHA(s), (b) `git merge-base --is-ancestor <sha> main` confirmation, (c) links to covering converter file + test on main. Scoped extras per audit: decide fix-vs-document for #138 non-reversible VALARM sub-properties (DESCRIPTION, EMAIL ATTENDEE/SUMMARY, AUDIO ATTACH) and add the missing named regression test for the #143 bare-VTIMEZONE wrap fix (8de651546). **No converter rebuilds** — the audit found no missing feature
- **Verify with:** `gh issue view` per issue (closed + evidence comment); `composer test` for any added regression tests
- **Parallel with:** A, B, C

### Chunk F: OpenAPI alignment + docs

- **id:** `chunk-f-openapi-docs`
- **Skill:** api, document
- **Inputs:** everything shipped in A–D
- **Done when:** `openapi/schemas/calendars/` covers all new endpoints and the contract gate passes; `packages/api/docs/calendars/jmap-calendars-summary.md`, `packages/api/docs/jmap-rest-parity-gaps.md` (stale), and `packages/api/docs/contacts/jmap-sync-rest-mapping.md` (item `/changes` no longer deferred) reflect shipped state
- **Verify with:** `composer done-gate:contract` + doc review
- **Parallel with:** none (last, after A–D)

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** verify-issue, testing
- **Inputs:** [verify-issue](../../skills/verify-issue/SKILL.md) against #429 AC; [multitask-verifier.md](../../skills/developer/multitask-verifier.md) if chunks ran in parallel
- **Done when:** verifier `PASS` or `PASS_WITH_NITS`; `run_api_done_gate` (wgw-verify MCP; fallback `composer done-gate`) green including MySQL parity suite and cross-user ACL tests (`JmapRestCrossUserAclTest` extended for the new endpoints); body-hash in spec.md still matches #429
- **Verify with:** `run_api_done_gate`; `gh issue view 429 --json body --jq .body | shasum -a 256`
- **Parallel with:** none

## Test plan

- [ ] OpenAPI first → failing feature test → implement → `composer done-gate` per [testing/test-first.md](../../skills/testing/test-first.md)
- [ ] Sync tests: mutations via REST *and* raw CalDAV both surface in `/changes` (mirrors `ContactsCardsSyncTest` + `CalendarsCalDavInteropTest`)
- [ ] Multi-VEVENT composite-id cases in `/changes` and `/query` per the spec decision
- [ ] Converter edge-case tests only where the audit found gaps (#138 lossy VALARM sub-props if fixed; #143 VTIMEZONE-wrap regression test); consider Fastmail/Audriga fixtures (#160) for regressions
- [ ] MySQL parity suite (`phpunit-mysql-parity.xml`) for `jmap_calendar_event_states`
- [ ] Cross-user ACL checks for new endpoints (extend `JmapRestCrossUserAclTest`)

## Doc updates (only if user wants)

- Covered by Chunk F (explicitly in #429 AC)
