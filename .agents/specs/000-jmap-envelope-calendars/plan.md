# JMAP Calendars: real RFC 8620 transport envelope

Derived from [spec.md](./spec.md). `Source: ad-hoc` — issue creation was unavailable in the build environment; file a Task issue afterwards and renumber this folder per the `429-calendar-jmap-parity` convention. Engineering rows: [tasks.md](./tasks.md).

## Goal

A `/jmap` Session resource + batched method-call endpoint in front of the existing, unmodified calendar services, so `@lit-calendar/jmap-client` (shipped, separate repo) can talk to this backend with zero client-side changes.

## Non-goals

- Push (EventSource/WebSocket); `CalendarEvent/queryChanges`; JMAP Sharing; Contacts/Tasks/Files/Mail envelopes; changing the existing REST endpoints or their per-record `ifInState` behavior; any frontend changes — see [spec.md](./spec.md#non-goals).

## Affected packages

- packages/api only.

## Dependencies

1. Chunk A (Session resource) has no dependencies — start here.
2. Chunk B (batch endpoint + dispatcher skeleton + error mapping) depends on A (needs the Session's `apiUrl`/capabilities shape decided).
3. Chunks C, D, E (method implementations behind the dispatcher) depend on B and are otherwise independent of each other, but touch overlapping dispatcher routing code — **sequential within one agent**, same reasoning as `429-calendar-jmap-parity`'s A→B→C.
4. Chunk F (integration verification against the real, unmodified client) runs last, after C/D/E.
5. Chunk G (docs) after F.

## Chunks

### Chunk A: JMAP Session resource

- **id:** `chunk-a-jmap-session`
- **Skill:** api
- **Inputs:** [spec.md §Technical decisions 1–2](./spec.md#technical-decisions); `JmapSession`/`JmapAccount` types in `lit-calendar/packages/jmap-client/src/core/types.ts` (ground truth, read-only reference in the other repo — do not edit it); `CORE_CAPABILITY`/`CALENDARS_CAPABILITY` constants at `core/types.ts:12-13`
- **Done when:** `GET /api/v1/jmap/session` (or chosen path) returns a body satisfying `JmapSession` exactly (all fields present, correct types); `accountId` is the raw username (already JMAP `Id`-safe, `^[a-z0-9][a-z0-9_-]{1,62}$` — spec §1; no base64url); `primaryAccounts` maps both capability URNs to the same accountId; session-level `urn:ietf:params:jmap:calendars` capability is the **empty object** and the six-property object (`maxCalendarsPerEvent`, `minDateTime`, `maxDateTime`, `maxExpandedQueryDuration`, `maxParticipantsPerEvent`, `mayCreateCalendar`) lives in `accountCapabilities` (draft-27 §1.5.1, resolved in spec §Resolved verification items — placement matters, an earlier draft had it inverted); `apiUrl`/`downloadUrl`/`uploadUrl`/`eventSourceUrl` are **absolute URLs** (the client fetches `apiUrl` verbatim, no base-URL resolution — spec §2); feature test asserts the full JSON shape against the client's TS type (manually cross-checked field-by-field, since there's no shared schema)
- **Verify with:** `composer done-gate` (packages/api) + manual field-by-field diff against `core/types.ts`
- **Parallel with:** none (first)

### Chunk B: Batch endpoint + method dispatcher + error mapping

- **id:** `chunk-b-jmap-dispatcher`
- **Skill:** api
- **Inputs:** [spec.md §Technical decisions 3, 4 (codec part), 7](./spec.md#technical-decisions); `JmapRequest`/`JmapResponse`/`JmapInvocation` types and `JmapClient.request()`/`.call()` in `core/JmapClient.ts` (exact client-side parsing to satisfy); `core/errors.ts` (`JmapMethodError`, `JmapSetItemError` — what a malformed envelope does to client-side error handling)
- **Done when:** `POST /api/v1/jmap` accepts `{using, methodCalls}`, always returns HTTP 200 for structurally valid batches (non-2xx reserved for malformed JSON/missing methodCalls/unsupported `using`), resolves `"#ids"`-style ResultReferences per the algorithm in spec.md (RFC 6901 JSON Pointer against a prior call's response args), returns `invalidResultReference` on failed resolution, `invalidArguments` when both `#foo` and `foo` are present (RFC 8620 §3.7), and `unknownMethod` for unregistered names, dispatching to a registered-method table that at this point has **zero implemented methods** (this chunk is transport plumbing only, no calendar semantics yet); **the envelope state codec ships here too** (`composeAccountState`/`decomposeAccountState`, spec §4 — always count-prefixed, empty-map round-trip via `"0:"`/`"0"`/`""`), since C, D, and E all consume it; feature test covers: single call round-trip against a stub method, back-reference resolution against two stub methods, `#foo`+`foo` conflict → `invalidArguments`, malformed body → non-2xx, unknown method → `unknownMethod` inside a 200, and codec round-trip for empty/single/multi-calendar maps
- **Verify with:** `composer done-gate`
- **Parallel with:** none (after A)

### Chunk C: `Calendar/*` and `CalendarEvent/get`, `/query`

- **id:** `chunk-c-jmap-get-query`
- **Skill:** api
- **Inputs:** [spec.md dispatch table](./spec.md#technical-decisions) rows for `Calendar/get`, `Calendar/set`, `CalendarEvent/get`, `CalendarEvent/query`; existing `CalendarRepository::list()`, `CalendarEventRepository::calendarSyncTokens()` (reuse verbatim, `:163-177`), `CalendarEventRepository::show()` (per-id lookup, `:552-565` — no multi-id method exists, loop in the dispatcher), `CalendarEventRepository::query()` (reuse verbatim); Chunk B's envelope state codec (spec §4); myRights mapping table in spec.md §6
- **Done when:** these four methods are registered in the dispatcher from Chunk B and produce responses satisfying `GetResponse<T>`/`QueryResponse`/`SetResponse<T>` exactly; every top-level `state`/`queryState` is composed with the envelope codec over all owned VEVENT calendars (NOT `composeCalendarState()` — its single-calendar output is not decomposable, spec §4); `CalendarEvent/query` **injects** `filter.inCalendars = <all owned VEVENT calendar uris>` when the client omits it, before calling the repository — the 400 lives inside `CalendarEventRepository::resolveQueryCalendars()` (`:192-194`), not just the FormRequest, so skipping validation isn't enough (this is the exact call pattern `JmapEventsAdapter.loadRange()` uses); `Calendar/get`'s `myRights` uses the new mapping table, not the raw REST shape; feature test replicates the request/response pairs `lit-calendar/packages/jmap-client/src/tests/client.test.ts` exercises against `MockJmapServer` (mock at `src/mock/MockJmapServer.ts`, fixtures at `src/mock/fixtures.ts`) for these methods (read those files for exact fixtures, don't invent new ones)
- **Verify with:** `composer done-gate`
- **Parallel with:** none (after B, before D/E in the same agent — shares dispatcher routing table)

### Chunk D: `CalendarEvent/changes` and `Calendar/changes` (account-wide)

- **id:** `chunk-d-jmap-changes`
- **Skill:** api
- **Inputs:** [spec.md §Technical decisions 4](./spec.md#technical-decisions) — full fan-out algorithm already specified; Chunk B's envelope state codec (compose/decompose — do NOT use `composeCalendarState()`/`parseInstancesState()` directly, they don't round-trip single-calendar or empty states); existing per-calendar `CalendarEventRepository::changes()` (reuse unmodified, `:408-436`); `JmapCalendarEventStateService::recordedEventIdsForObject()` (`JmapCalendarEventStateService.php:70-79`; the usage pattern to mirror is `CalendarEventRepository::destroyedEventIds()`, a **private method on the repository** at `:483-501` — not on the state service)
- **Done when:** account-wide `CalendarEvent/changes(accountId, sinceState, maxChanges?)` implements the exact algorithm in spec.md (new-calendar → all-created, token-changed → merge existing per-calendar changes, calendar-gone → all-recorded-ids-destroyed), with `sinceState` decomposed and `newState` composed via the envelope codec; `Calendar/changes` is the same algorithm one level up over calendar existence; both report `hasMoreChanges: false` (matches existing per-calendar honesty); malformed `sinceState` → `cannotCalculateChanges`; feature test covers all four fan-out branches (unchanged calendar, changed calendar, newly-visible calendar, removed calendar) plus the malformed-token case plus the single-calendar-account round-trip (state from a prior get/set decomposes cleanly — the mismatch-13 regression)
- **Verify with:** `composer done-gate`
- **Parallel with:** none (after B; can run alongside C if a second agent coordinates on the dispatcher routing table, otherwise sequential — same caveat as `429-calendar-jmap-parity` A→B→C)

### Chunk E: `CalendarEvent/set` with true top-level `ifInState`

- **id:** `chunk-e-jmap-set`
- **Skill:** api
- **Inputs:** [spec.md §Technical decisions 3 (dispatch table row) and 5](./spec.md#technical-decisions); `CalendarEventSetService::set()` (reuse unmodified — do **not** touch its per-record `ifInState` handling, that stays for the legacy REST endpoint); Chunk B's envelope state codec + `calendarSyncTokens()` (same as Chunk C)
- **Done when:** `CalendarEvent/set` dispatch checks `args.ifInState` (if present) against `composeAccountState(calendarSyncTokens($username))` **before** calling `CalendarEventSetService::set()`; mismatch → method-level `["error", {"type":"stateMismatch"}, callId]`, service is not called; match or absent → call the service normally, pass `created`/`updated`/`destroyed`/`not*` through as-is (already RFC 8620-shaped per the prior compliance review) **but replace top-level `oldState`/`newState`** with envelope-codec states composed account-wide before/after the call — the service's own values are touched-calendar-scoped and collapse single calendars to a bare token (`resolveSetStates()`, `CalendarEventSetService.php:91-111`), which the client would replay as an undecomposable `sinceState` (spec §5, mismatch 13); feature test covers: no `ifInState` (always proceeds), matching `ifInState` (proceeds), stale `ifInState` (method-level `stateMismatch`, no mutation occurs — assert the underlying data is unchanged), and set-then-changes on a single-calendar account (returned `newState` must be accepted by `CalendarEvent/changes` without `cannotCalculateChanges`)
- **Verify with:** `composer done-gate`
- **Parallel with:** none (after B; can run alongside C/D with the same dispatcher-routing-table caveat)

### Chunk F: Integration verification against the real client

- **id:** `chunk-f-jmap-client-verify`
- **Skill:** api, testing
- **Inputs:** `lit-calendar/packages/jmap-client/src/tests/client.test.ts`, `adapter.test.ts` (exact request/response pairs already exercised against `MockJmapServer` — a fetch-level mock at `src/mock/MockJmapServer.ts`, not an HTTP server; the compliance bar is reproducing these against the real backend, not inventing new assertions); [spec.md §Acceptance / compliance verification plan](./spec.md#acceptance--compliance-verification-plan)
- **Done when:** either (a) an integration test in `lit-calendar` points a real `JmapClient`/`JmapCalendarsClient`/`JmapEventsAdapter` at a running `sabre-installer` test instance — configuration only: absolute `sessionUrl` + `headers: {Authorization: "Bearer <jwt>"}` via existing `JmapClientOptions`, which depends on Chunk A emitting absolute URLs — and exercises `initialize()` → `refreshCalendars()` → `loadRange()` → `sync()` → `create()`/`update()`/`remove()` → `flush()` end-to-end with zero client-side code modifications, asserting the post-`flush()` `sync()` takes the incremental `/changes` path (no `cannotCalculateChanges` fallback — the mismatch-13 regression check); or (b) equivalent backend-side feature tests assert byte-for-byte the same request/response fixtures already used against `MockJmapServer`; existing `composer done-gate` for the untouched REST endpoints stays green (no regression)
- **Verify with:** the integration test itself; `composer done-gate`
- **Parallel with:** none (last functional chunk, after C/D/E)

### Chunk G: Docs

- **id:** `chunk-g-jmap-docs`
- **Skill:** api, document
- **Inputs:** everything shipped in A–F
- **Done when:** a new `packages/api/docs/calendars/jmap-envelope.md` documents the Session resource shape, the dispatch table, the envelope state codec and fan-out algorithm, the `ifInState` reconciliation decision, and the event-id charset deviation (spec §8) — mirroring the level of detail in `packages/api/docs/calendars/jmap-calendars-summary.md`; `packages/api/docs/jmap-rest-parity-gaps.md` (note: lives under `packages/api/docs/`, not repo-root `docs/`) updated to note the envelope now exists alongside the REST layer (both are supported entry points, not a replacement) — that file and `jmap-calendars-summary.md` currently declare the envelope an explicit non-goal, so both need their scope statements revised, not just appended to
- **Verify with:** doc review
- **Parallel with:** none (last)

## Test plan

- [ ] Chunk B ships with zero calendar semantics — pure transport tests (back-reference resolution, `#foo`+`foo` conflict, envelope status codes, unknown-method handling) plus envelope-codec round-trip tests (empty / single / multi-calendar maps — the empty and single cases are exactly where the existing helpers fail, spec §4) before any method is real
- [ ] Every method chunk (C, D, E) replicates the exact fixtures already exercised against `MockJmapServer` (`lit-calendar/packages/jmap-client/src/mock/`, tests in `src/tests/`) — do not invent new request/response shapes when a ground-truth example already exists
- [ ] Chunk D's four fan-out branches (unchanged / changed / newly-visible / removed calendar) each get a named test — this plus the codec is the genuinely new logic in the whole proposal
- [ ] Chunk E's `stateMismatch` test asserts no mutation occurred (not just that the error was returned), and its happy path asserts the returned `newState` is decomposable by `CalendarEvent/changes` on a single-calendar account (the mismatch-13 regression)
- [ ] Chunk F is the real gate: a passing end-to-end run of the *unmodified* client against this backend, not a reimplementation of client-side assertions in PHP
- [ ] Existing `429-calendar-jmap-parity` REST endpoints and their tests must stay green throughout — this work is additive

## Doc updates

- Covered by Chunk G.
