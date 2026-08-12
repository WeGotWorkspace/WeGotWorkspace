# JMAP transport envelope (calendars)

A genuine RFC 8620 JMAP-over-HTTP transport in front of the same calendar services the REST layer uses, so a spec-faithful JMAP client (specifically the shipped `@lit-calendar/jmap-client`, separate repo) can talk to this backend with **zero client-side changes**. The REST endpoints (`docs/calendars/jmap-calendars-summary.md`) are unchanged; the envelope is an **additive third protocol adapter** next to REST and CalDAV — one database, one process, three fronts.

Spec: `.agents/specs/000-jmap-envelope-calendars/` · Tests: `tests/Feature/Jmap/`, `tests/Unit/Jmap/`

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/v1/jmap/session` | Session resource (RFC 8620 §2) |
| `POST /api/v1/jmap` | Batched method calls (§3) |
| `GET /api/v1/jmap/download/{accountId}/{blobId}/{name}` | 501 stub — structurally required by the Session, unused by the calendar client |
| `POST /api/v1/jmap/upload/{accountId}` | 501 stub |
| `GET /api/v1/jmap/events/{types}/{closeafter}/{ping}` | 501 stub — Push is a non-goal; the client polls |

All behind `wgw.auth` + `wgw.role:user` + `wgw.calendars` (same gates as the calendars REST group).

## Session resource

- **One account per authenticated principal; `accountId` = the raw username.** Usernames (`^[a-z0-9][a-z0-9_-]{1,62}$`) are a strict subset of the JMAP `Id` charset — no encoding. `primaryAccounts` maps both `urn:ietf:params:jmap:core` and `urn:ietf:params:jmap:calendars` to it.
- **Capability placement per draft-ietf-jmap-calendars-27 §1.5.1:** the session-level calendars capability is the **empty object**; the six-property object (`maxCalendarsPerEvent: 1`, `minDateTime`, `maxDateTime`, `maxExpandedQueryDuration`, `maxParticipantsPerEvent`, `mayCreateCalendar`) lives in `accountCapabilities`.
- **All URLs are absolute** (built from the request): the client fetches `apiUrl` verbatim with no base-URL resolution.
- `state` is the constant `JmapCapabilities::SESSION_STATE`, echoed as `sessionState` on every `POST /jmap` response; the client only reacts to it changing.
- Advertised limits are enforced: `maxCallsInRequest` (32, request-level `urn:ietf:params:jmap:error:limit`), `maxObjectsInGet` (500) and `maxObjectsInSet` (200) (method-level `requestTooLarge`), `maxSizeRequest`.

## Batch endpoint

`POST /api/v1/jmap` **always returns HTTP 200 for structurally valid batches** — individual method failures travel as `["error", {type, description?}, callId]` invocations inside `methodResponses`. Non-2xx (RFC 7807 problem details, §3.6.1) is reserved for malformed JSON (`notJSON`), non-Request bodies (`notRequest`), unsupported `using` capabilities (`unknownCapability`), and size limits (`limit`).

ResultReferences (§3.7): every `#key` argument is resolved against the matching earlier response via RFC 6901 JSON Pointer plus the `*` array-mapping extension. Failed resolution → `invalidResultReference`; `#foo` and `foo` both present → `invalidArguments`. The one reference the shipped client sends is `"#ids"` (`path: "/ids"`) on its `CalendarEvent/query` → `CalendarEvent/get` batch.

## Method dispatch table

| JMAP method | Backing service (unmodified) | Notes |
|---|---|---|
| `Core/echo` | — | §4; also the transport-test stub |
| `Calendar/get` | `CalendarRepository::list()` | 8-property `myRights` mapping (below) |
| `Calendar/changes` | `CalendarEventRepository::calendarSyncTokens()` | Existence/token diff via the envelope codec |
| `Calendar/set` | `CalendarRepository::create/update/delete` | Top-level `ifInState`; `onDestroyRemoveEvents` → `calendarHasEvent` SetError when refused |
| `CalendarEvent/get` | `CalendarEventRepository::show()` per id / `list()` per calendar | Multi-id loop lives in the dispatcher |
| `CalendarEvent/changes` | per-calendar `CalendarEventRepository::changes()` | Account-wide fan-out (below) |
| `CalendarEvent/set` | `CalendarEventSetService::set()` | True top-level `ifInState`; account-wide state recomposition (below) |
| `CalendarEvent/query` | `CalendarEventRepository::query()` | Injects `filter.inCalendars` = all owned VEVENT calendars when absent (the shipped adapter never sends it) |
| `CalendarEvent/queryChanges` | — | Always `cannotCalculateChanges` (matches `canCalculateChanges: false`); part of the advertised capability, so `unknownMethod` would be a lie |

Method-level error vocabulary (§3.6.2): `unknownMethod`, `invalidArguments`, `invalidResultReference`, `stateMismatch`, `cannotCalculateChanges`, `accountNotFound`, `forbidden`, `requestTooLarge`, `serverFail`. SetError types reuse the REST layer's camelCase vocabulary; unknown internal codes normalize to `serverFail` instead of inventing types.

## Envelope state codec + `CalendarEvent/changes` fan-out

The envelope owns its account-wide state format (`JmapAccountStateCodec`): **always** `{count}:{uri}:{token},...` sorted by uri — zero calendars compose to `"0:"`, and `""`/`"0"`/`"0:"` all decompose to the empty map. This exists because the REST helpers don't round-trip: `composeCalendarState()` collapses a single calendar to a bare synctoken (undecomposable), and `parseInstancesState()` rejects `"0:"`. Every top-level `state`/`oldState`/`newState`/`queryState` the envelope emits is composed with this codec over **all** owned VEVENT calendars; per-item `state` tokens inside `created`/`updated` pass through unchanged.

Account-wide `CalendarEvent/changes(accountId, sinceState)`:

1. Decompose `sinceState`; malformed → `cannotCalculateChanges`.
2. Per current calendar: not in `sinceState` → all its events `created`; token changed → merge the existing per-calendar `changes()` delta; unchanged → skip.
3. Per `sinceState` calendar that no longer exists → every event id previously recorded for it (`JmapCalendarEventStateService::recordedEventIdsForCalendar()`) is `destroyed`.
4. `oldState` echoes `sinceState`; `newState` composes the current tokens; `hasMoreChanges` is always `false` (same honest Sabre limitation as REST: the change log can't produce a safe intermediate token, so `maxChanges` is validated but never truncates).

`Calendar/changes` is the same diff one level up over calendar existence/tokens. **Empirically pinned behaviors** (`JmapChangesTest`): Sabre bumps the synctoken on pure metadata updates, so renames/recolors **are** reported as `updated` (the spec-review caveat resolved favorably); event activity also bumps it, so calendars **over-report** as `updated` on event-only changes (harmless — clients refetch metadata that didn't change). Sabre's metadata change-log entry carries an empty object uri; the repository skips it so no phantom event ids leak (fixed on the REST path too).

## `ifInState` reconciliation (`CalendarEvent/set`)

Two coexisting concurrency models, deliberately not unified:

- **REST `POST /calendars/events/set`** keeps its documented per-record `ifInState` divergence (item state tokens are per event) — untouched, for existing REST consumers.
- **The envelope's `CalendarEvent/set`** implements genuine RFC 8620 §5.3 **top-level** `ifInState`: compared against the codec-composed account state *before* the service runs; mismatch → method-level `stateMismatch`, nothing mutated. On success the per-item shapes pass through verbatim, but top-level `oldState`/`newState` are **replaced** with account-wide codec states — the service's own values are touched-calendar-scoped and collapse single calendars to a bare token, which the client would replay as an undecomposable `sinceState` (the "mismatch 13" bug class; regression-tested in `JmapEventSetTest` and `JmapClientContractTest`).

## `myRights` mapping

Sabre's 3-level access maps onto the draft's 8-property `CalendarRights` (`CalendarRightsMapper`):

| Sabre `access` | mayReadFreeBusy | mayReadItems | mayWriteAll | mayWriteOwn | mayUpdatePrivate | mayRSVP | mayShare | mayDelete |
|---|---|---|---|---|---|---|---|---|
| `2` (read-only) | true | true | false | false | false | false | false | false |
| `3` (read-write) | true | true | true | true | true | true | false | false |
| owner (default) | true | true | true | true | true | true | false | `uri !== 'default'` |

## Documented deviations

- **Event id charset:** composite multi-VEVENT ids are `{objectId}#{veventUid}`; `#` is outside the JMAP `Id` charset (RFC 8620 §1.2). Ids pass through unchanged — the shipped client treats ids as opaque strings, and encoding at the boundary would break id parity with REST and the state bookkeeping for zero practical gain. Revisit only if a strict third-party client becomes a target.
- **Push** (RFC 8620 §7) is not implemented; `eventSourceUrl` is a 501 stub. The shipped client polls.
- **`createdIds`** request/response maps are ignored/omitted (the client never sends them).
- **Update payloads are plain partial objects**, not RFC 8620 PatchObjects with `/`-separated paths — matching what the shipped adapter sends and what the underlying set service accepts.
