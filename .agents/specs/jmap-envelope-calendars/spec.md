Source: no GitHub issue yet — architecture proposal derived from the `429-calendar-jmap-parity` audit and a live cross-repo compliance review against `@lit-calendar/jmap-client` (2026-08-13). Refined 2026-08-13 after a second cross-repo verification pass (every code citation re-checked against both repos; draft-ietf-jmap-calendars-27 consulted); see §Resolved verification items.

# JMAP Calendars: real RFC 8620 transport envelope

Technical proposal for wrapping the already-shipped calendar services (`429-calendar-jmap-parity`) in a genuine JMAP-over-HTTP transport, so the already-shipped `@lit-calendar/jmap-client` (separate repo: `lit-calendar`) can talk to this backend **without any client-side changes**.

## Problem analysis

### What exists today

`packages/api` exposes a **deliberately REST-shaped subset** of JMAP Calendars — discrete endpoints (`GET/POST/PATCH/DELETE /calendars/calendars`, `GET/POST/PATCH/DELETE /calendars/events`, `GET /calendars/events/changes`, `POST /calendars/events/set`, `POST /calendars/events/query`), no `accountId`, no request batching, no JMAP Session resource. This was an explicit, documented non-goal of `429-calendar-jmap-parity` ("Full JMAP protocol envelope (`/jmap` session, method calls)"), made at a time when "the calendar frontend does not exist yet, so shapes were free to change" (`tasks.md`, RFC 8620 conformance pass note).

The frontend now exists, in a separate repo (`lit-calendar`), and is **not** a REST client — `packages/jmap-client` is a literal RFC 8620 implementation:

- `core/JmapClient.ts`: `connect()` GETs a Session resource and requires both `urn:ietf:params:jmap:core` and `urn:ietf:params:jmap:calendars` in its `capabilities`; `request()` POSTs a single `{using, methodCalls}` body to `session.apiUrl` and parses `{methodResponses, sessionState}` back.
- `calendars/JmapCalendarsClient.ts`: every method (`Calendar/get`, `Calendar/changes`, `Calendar/set`, `CalendarEvent/get`, `CalendarEvent/changes`, `CalendarEvent/set`, `CalendarEvent/query`, `CalendarEvent/queryChanges`) requires an explicit `accountId`. `getCalendarEventsInRange()` sends two method calls in one batch, wired together with a ResultReference (`"#ids": {resultOf, name, path}`).
- `adapter/JmapEventsAdapter.ts`: the actual UI-facing consumer, already wired into the calendar components, unit-tested against `MockJmapServer` (a pure JMAP-shaped fake — not a hint at an integration plan, just a test double).

**Verified fact, not assumption:** `grep -r "methodCalls\|methodResponses\|primaryAccounts\|apiUrl" packages/api/app` returns zero hits outside `node_modules`. No JMAP Session resource, no batch endpoint, no `accountId` concept exists anywhere in the backend. `JmapClient.connect()` fails on the first call today; nothing downstream is reachable.

### Root cause

JMAP compliance is defined by RFC 8620 as a **specific wire transport** (Session resource + one batched method-call endpoint + back-references), not by object/field naming. A REST facade using JMAP-shaped field names is not JMAP by the spec's own definition, and a spec-faithful client (the one already shipped) cannot be pointed at it without a transport-level bridge.

### Why this is fixable without a rewrite

`sabre/dav` is **not a separate server**. It's a Composer library (`sabre/dav: ^4.7`) instantiated in-process:

```php
use Sabre\CalDAV\Backend\PDO as CalPDO;
...
return new CalPDO(DB::connection('wgw')->getPdo());
```

The existing CalDAV protocol endpoint (`app/Dav/SabreWebdavFront.php`) is itself just another Laravel route that builds a `Sabre\DAV\Server` per request against the same `calendarobjects`/`calendarchanges`/`calendars` tables the REST API already reads/writes via `CalendarEventRepository`, `CalendarEventSetService`, `CalendarRepository`. There is nothing to "sync" — one database, one PHP process, multiple protocol adapters in front of it. The JMAP envelope is a **third adapter**, calling the same service classes the REST adapter already calls.

This also means it's compatible with LAMP/shared hosting: the JMAP core request/response cycle (Session GET + batched POST) is stateless, one-request-one-response, exactly like every other route in this app. The only JMAP feature that's genuinely awkward on typical shared-hosting PHP-FPM worker pools is real-time Push (EventSource/WebSocket, RFC 8620 §7) — and Push is optional; the shipped client already implements polling (`JmapEventsAdapter.startPolling()`), which fully satisfies JMAP's sync model without it. Push is a non-goal here (see below).

### Confirmed mismatches this proposal must close

| # | Mismatch | Evidence |
|---|----------|----------|
| 1 | No Session resource | 0 hits for `capabilities`/`primaryAccounts`/`apiUrl` in `packages/api/app` |
| 2 | No batch endpoint | `routes/api.php` calendars group is 15 discrete REST routes (`api.php:250-273`, incl. `GET calendars/calendars/changes` and `PUT calendars/events/{eventId}`), no single POST target |
| 3 | No back-reference resolution | No batching primitive exists to resolve `"#ids"` against |
| 4 | No `accountId` concept | Backend scopes everything by `wgw.auth` principal/username, never an account id |
| 5 | `CalendarEvent/changes` is per-calendar in the backend, account-wide in the client | `GET /calendars/events/changes` requires `calendarId`; `JmapCalendarsClient.calendarEventChanges(accountId, sinceState)` never supplies one |
| 6 | No multi-id `CalendarEvent/get` | `GET /calendars/events` is one-calendar-scoped list; `GET /calendars/events/{id}` is one-at-a-time |
| 7 | Get-shaped responses lack `state`/`accountId`/`notFound` | `CalendarEventRepository`/`CalendarRepository` list methods return bare arrays |
| 8 | `CalendarEvent/queryChanges` unimplemented | No route, no controller method, no service method (client never calls it — dormant, not urgent) |
| 9 | REST error bodies (`{error, code}` + HTTP status) don't map to JMAP method-errors | `JmapClient.request()` only inspects `response.ok`; there's no `methodResponses` envelope to carry an `error` invocation |
| 10 | `Calendar/set` has no counterpart | Calendar create/delete are bare-resource REST responses, no created/updated/destroyed/notCreated envelope |
| 11 | `myRights` vocabulary differs | Backend: `{mayRead, mayWrite, mayShare, mayDelete}` (`CalendarRepository.php:284-288`, `mayShare` always `false`); client expects `{mayReadFreeBusy, mayReadItems, mayWriteAll, mayWriteOwn, mayUpdatePrivate, mayRSVP, mayShare, mayDelete}` (`calendars/types.ts:11-20`) |
| 12 | `baseEventId`/`isOrigin`/`utcStart`/`utcEnd` never emitted | Optional in the client type, currently just absent — low priority |
| 13 | Account-wide state strings are not decomposable | `composeCalendarState()` collapses a single calendar to a bare synctoken (`CalendarEventRepository.php:143-156`), which cannot be mapped back to `uri => token`; `CalendarEventSetService::set()` scopes `oldState`/`newState` to *touched* calendars only (`resolveSetStates()`, `CalendarEventSetService.php:91-111`). Neither string can serve as the `sinceState` for an account-wide `/changes` — see §4 |
| 14 | Composite event ids violate the JMAP `Id` charset | Multi-VEVENT objects surface as `{objectId}#{veventUid}` (`CalendarConversionSupport::compositeEventId`); `#` is outside `A-Za-z0-9_-` (RFC 8620 §1.2). The shipped client never validates ids (`JmapId` is a bare `string` alias) — accepted deviation, see §8 |

Items 1–7, 9, 10, 13 are blockers (nothing works without them — 13 silently breaks sync for single-calendar accounts, the common case). 8 and 12 are explicitly deferred (see Non-goals). 11 is a small, self-contained fix. 14 is a documented deviation, not a work item.

## Goal

Build a thin JMAP transport envelope — a Session resource endpoint and a batched `/jmap` API endpoint with method dispatch and ResultReference resolution — in front of the **existing, unmodified** calendar services, so that:

1. `@lit-calendar/jmap-client`, exactly as shipped today, can `connect()`, `getCalendars()`, `loadRange()`, `sync()`, and push local edits through `setCalendarEvents()` against this backend with **zero client-side code changes**.
2. The backend is genuinely compliant with RFC 8620 (Core), the current JMAP Calendars draft, and RFC 8984 (JSCalendar) at the wire boundary — not just in field naming.
3. If the storage backend is ever replaced, only the dispatcher's internals change; the wire contract (and therefore every client, present and future) is unaffected.

## Non-goals

- **Push** (EventSource/WebSocket, RFC 8620 §7). The client already polls (`startPolling()`); this is optional and deferred. The Session resource still advertises the required URL fields (see Technical decisions), but the endpoint itself may return `501`/an immediately-closed stream — no client code path depends on it today.
- **`CalendarEvent/queryChanges`**. Advertise `canCalculateChanges: false` (already the convention on `queryState`, per `CalendarEventRepository.php:132`). The client exposes `queryChangesCalendarEvents()` but nothing (adapter or tests) ever calls it; `Calendar/queryChanges` does not exist anywhere in the client package.
- **JMAP Sharing** (RFC 9670, `shareWith`). Already a stub (`shareWith: null`) in the REST layer; stays that way.
- **Contacts, Tasks, Files, Mail JMAP envelopes.** Calendars only. The dispatcher's design should not preclude adding these later, but implementing them is out of scope here.
- **Changing the existing REST endpoints.** `POST /calendars/events/set` and friends keep their current (already-fixed) per-record `ifInState` behavior unmodified, for existing REST consumers. The new envelope is additive and implements genuine top-level `ifInState` independently — the two concurrency models coexist, they don't need to be unified.
- **Rewriting the frontend.** Out of scope by definition — the entire point is that it doesn't need to change.

## Affected packages

- `packages/api` only. New: session controller, `/jmap` batch controller, a method-dispatcher service, and an envelope-owned state codec (§4). The existing repositories/services need **no modification**: multi-id get is a dispatcher-level loop over `CalendarEventRepository::show()`, account-wide sync-token enumeration already exists (`calendarSyncTokens()`), and the state codec lives in the envelope layer. No changes required in `lit-calendar`, but its existing test suite (`packages/jmap-client/src/tests/*` plus `src/mock/MockJmapServer.ts`) and the live `JmapEventsAdapter` are the compliance oracle: if a real integration test using the *unmodified* `JmapCalendarsClient` against this backend passes, the envelope is correct by definition.

## Ground-truth contracts (authoritative — do not deviate)

The shipped client's TypeScript types are the actual runtime contract; nothing else guarantees compatibility. Quoted verbatim from `lit-calendar/packages/jmap-client/src/core/types.ts` (already spot-checked against RFC 8620 in a prior review — treat as correct):

```ts
export type JmapSession = {
  capabilities: Record<string, unknown>;
  accounts: Record<JmapId, JmapAccount>;
  primaryAccounts: Record<string, JmapId>;
  username: string;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  state: string;
  [key: string]: unknown;
};

export type JmapAccount = {
  name: string;
  isPersonal: boolean;
  isReadOnly: boolean;
  accountCapabilities: Record<string, unknown>;
};

export type JmapRequest = { using: string[]; methodCalls: JmapInvocation[]; createdIds?: Record<JmapId, JmapId> };
export type JmapInvocation = [name: string, args: Record<string, unknown>, methodCallId: string];
export type JmapResponse = { methodResponses: JmapInvocation[]; createdIds?: Record<JmapId, JmapId>; sessionState: string };

export type JmapMethodErrorArgs = { type: string; description?: string; [key: string]: unknown };
export type JmapSetError = { type: string; description?: string; properties?: string[]; [key: string]: unknown };

export type GetArgs = { accountId: JmapId; ids?: JmapId[] | null; properties?: string[] | null };
export type GetResponse<T> = { accountId: JmapId; state: JmapState; list: T[]; notFound: JmapId[] };

export type ChangesArgs = { accountId: JmapId; sinceState: JmapState; maxChanges?: number };
export type ChangesResponse = { accountId: JmapId; oldState: JmapState; newState: JmapState; hasMoreChanges: boolean; created: JmapId[]; updated: JmapId[]; destroyed: JmapId[] };

export type SetArgs<T> = { accountId: JmapId; ifInState?: JmapState | null; create?: Record<JmapId, T> | null; update?: Record<JmapId, Record<string, unknown>> | null; destroy?: JmapId[] | null };
export type SetResponse<T> = { accountId: JmapId; oldState: JmapState | null; newState: JmapState; created?: Record<JmapId, Partial<T>> | null; updated?: Record<JmapId, Partial<T> | null> | null; destroyed?: JmapId[] | null; notCreated?: Record<JmapId, JmapSetError> | null; notUpdated?: Record<JmapId, JmapSetError> | null; notDestroyed?: Record<JmapId, JmapSetError> | null };

export type QueryArgs = { accountId: JmapId; filter?: Record<string, unknown> | null; sort?: Array<Record<string, unknown>> | null; position?: number; limit?: number; calculateTotal?: boolean };
export type QueryResponse = { accountId: JmapId; queryState: JmapState; canCalculateChanges: boolean; position: number; ids: JmapId[]; total?: number; limit?: number };
```

And from `calendars/types.ts`:

```ts
export type JmapCalendarRights = { mayReadFreeBusy: boolean; mayReadItems: boolean; mayWriteAll: boolean; mayWriteOwn: boolean; mayUpdatePrivate: boolean; mayRSVP: boolean; mayShare: boolean; mayDelete: boolean; [key: string]: unknown };
export type JmapCalendar = { id: JmapId; name: string; description?: string | null; color?: string | null; sortOrder?: number; isSubscribed?: boolean; isVisible?: boolean; isDefault?: boolean; includeInAvailability?: "all"|"attending"|"none"; timeZone?: string | null; shareWith?: Record<JmapId, JmapCalendarRights> | null; myRights?: JmapCalendarRights; [key: string]: unknown };
export type JmapCalendarEvent = JSCalendarEvent & { id: JmapId; baseEventId?: JmapId | null; calendarIds: Record<JmapId, true>; isDraft?: boolean; isOrigin?: boolean; utcStart?: JSCalendarUTCDateTime; utcEnd?: JSCalendarUTCDateTime; useDefaultAlerts?: boolean };
export type JmapCalendarEventFilterCondition = { inCalendars?: JmapId[] | null; after?: JSCalendarUTCDateTime; before?: JSCalendarUTCDateTime; uid?: string; text?: string; title?: string; description?: string; location?: string; [key: string]: unknown };
```

Every JSON shape the dispatcher produces below is written to satisfy these types field-for-field. `JmapEventsAdapter` calls sites to keep working, verbatim:

- `client.connect()` — needs a real Session resource.
- `getCalendars(accountId)` → `Calendar/get {accountId, ids: null}`.
- `getCalendarEventsInRange(accountId, range, {inCalendars?})` → batched `CalendarEvent/query` + `CalendarEvent/get` via `"#ids": {resultOf, name: "CalendarEvent/query", path: "/ids"}` (`JmapCalendarsClient.ts:155-168` — the JSON Pointer is exactly `/ids`). The filter always carries `after`/`before` (ISO 8601, milliseconds stripped to `Z`); `inCalendars` is included only when `options.inCalendars !== undefined`. **`options.inCalendars` is never passed by the adapter today** (`loadRange()` calls it with no `options` argument, `JmapEventsAdapter.ts:110-112`) — the dispatcher's `CalendarEvent/query` MUST NOT hard-require `filter.inCalendars`; default to all owned VEVENT calendars when absent. Note this enforcement lives in **two** places on the REST path: `CalendarEventQueryRequest.php:24` (`required|array|min:1`) *and* inside `CalendarEventRepository::resolveQueryCalendars()` (`CalendarEventRepository.php:192-194`, throws 400) — so skipping the FormRequest is not enough; the dispatcher must inject the default id list before calling `query()`.
- `calendarChanges(accountId, calendarState)` / `calendarEventChanges(accountId, eventState)` — both account-wide, no calendarId.
- `setCalendarEvents({accountId, create}/{update}/{destroy})` — never sends `ifInState` today; dormant but the shape must still be spec-legal.

Verified client behaviors the transport must account for (all re-checked 2026-08-13):

- **`session.apiUrl` is fetched verbatim** — `JmapClient.request()` passes it straight to `fetch` with no resolution against `sessionUrl` (`JmapClient.ts:112-146`). A relative `apiUrl` resolves against the *fetch environment's* base URL: fine for a same-origin browser, broken for a Node-side integration test. The Session resource must therefore emit **absolute URLs**.
- **`connect()` only key-checks capabilities** (`in` operator on `session.capabilities`, `JmapClient.ts:51-72`); it does not validate capability object contents, `accounts`, `primaryAccounts`, or `state`. It throws `JmapRequestError` if either `urn:ietf:params:jmap:core` or `urn:ietf:params:jmap:calendars` is missing.
- **The adapter derives its accountId from `session.primaryAccounts["urn:ietf:params:jmap:calendars"]`** (`JmapEventsAdapter.ts:84-87` → `JmapClient.primaryAccountId()`); it never scans `session.accounts`.
- **Auth is pure configuration**: the client takes a `headers` option merged into every request and/or a custom `fetch` (`JmapClientOptions`, `JmapClient.ts:16-28`). Pointing it at this backend means supplying the `Authorization: Bearer <jwt>` header — no client code change.
- **`createdIds` is never sent** by the client; `downloadUrl`/`uploadUrl`/`eventSourceUrl` are required by the `JmapSession` type but never read.
- **`sessionState` is compared after every POST** (`onSessionStateChange` fires on change); a constant value is safe.
- `MockJmapServer` lives at `packages/jmap-client/src/mock/MockJmapServer.ts` (fixtures in `src/mock/fixtures.ts`) and is a **fetch-level mock**, not an HTTP server — relevant to the Acceptance plan below.

## Technical decisions

### 1. Account id model

One JMAP account per authenticated principal. **`accountId = username`, used raw.** Usernames in this backend are constrained to `^[a-z0-9][a-z0-9_-]{1,62}$` (`AdminUserCreateRequest.php:22`, enforced again in `AdminUserProvisionerService.php:192`), which is already a strict subset of the JMAP `Id` charset (`A-Za-z0-9`, `-`, `_`, 1–255 octets, RFC 8620 §1.2) — no encoding needed. (An earlier draft of this spec proposed `base64url(username)` on the assumption usernames could be email-like; verified false — email is a separate principal field, never the username.) `primaryAccounts` maps both `urn:ietf:params:jmap:core` and `urn:ietf:params:jmap:calendars` to this same id. `accounts[accountId] = {name: username, isPersonal: true, isReadOnly: false, accountCapabilities: {"urn:ietf:params:jmap:calendars": {…}}}` (see §2 for the accountCapabilities object — it is *not* empty; the empty object goes at the session level). Every dispatched method call compares `args.accountId` against the authenticated principal's username (`wgw.principal` set by `wgw.auth` / `AuthenticateWgwApi`); mismatch → method-level error `accountNotFound`.

### 2. Session resource

`GET /api/v1/jmap/session` (exact path is arbitrary — the client is configured with `sessionUrl`, document whatever is chosen). Behind `wgw.auth`. Body:

```json
{
  "capabilities": {
    "urn:ietf:params:jmap:core": {
      "maxSizeUpload": 5000000,
      "maxConcurrentUpload": 4,
      "maxSizeRequest": 2000000,
      "maxConcurrentRequests": 4,
      "maxCallsInRequest": 32,
      "maxObjectsInGet": 500,
      "maxObjectsInSet": 200,
      "collationAlgorithms": ["i;unicode-casemap"]
    },
    "urn:ietf:params:jmap:calendars": {}
  },
  "accounts": {
    "<accountId>": {
      "name": "<username>",
      "isPersonal": true,
      "isReadOnly": false,
      "accountCapabilities": {
        "urn:ietf:params:jmap:calendars": {
          "maxCalendarsPerEvent": 1,
          "minDateTime": "1970-01-01T00:00:00Z",
          "maxDateTime": "2100-01-01T00:00:00Z",
          "maxExpandedQueryDuration": "P1Y",
          "maxParticipantsPerEvent": null,
          "mayCreateCalendar": true
        }
      }
    }
  },
  "primaryAccounts": { "urn:ietf:params:jmap:core": "<accountId>", "urn:ietf:params:jmap:calendars": "<accountId>" },
  "username": "<username>",
  "apiUrl": "https://<host>/api/v1/jmap",
  "downloadUrl": "https://<host>/api/v1/jmap/download/{accountId}/{blobId}/{name}?type={type}",
  "uploadUrl": "https://<host>/api/v1/jmap/upload/{accountId}",
  "eventSourceUrl": "https://<host>/api/v1/jmap/events/{types}/{closeafter}/{ping}",
  "state": "<opaque — see below>"
}
```

Capability placement is defined by draft-ietf-jmap-calendars-27 §1.5.1 (verified 2026-08-13): the **session-level** `urn:ietf:params:jmap:calendars` value is an **empty object**; the account-level `accountCapabilities` value MUST contain `maxCalendarsPerEvent` (UnsignedInt|null), `minDateTime`/`maxDateTime` (UTCDateTime), `maxExpandedQueryDuration` (Duration), `maxParticipantsPerEvent` (UnsignedInt|null), `mayCreateCalendar` (Boolean). The values above are illustrative defaults — pick honest ones at implementation time (`maxCalendarsPerEvent: 1` reflects the current single-calendar-per-event storage model; `mayCreateCalendar: true` reflects the existing `POST /calendars/calendars`). The shipped client only key-checks `capabilities` (see Ground-truth contracts), so these values are for genuine draft compliance, not client compatibility.

**All URLs must be absolute** (built from the request, e.g. Laravel `url()`), because the client fetches `session.apiUrl` verbatim with no base-URL resolution — a relative path breaks any non-browser consumer, including this proposal's own integration test (Acceptance item 1). `downloadUrl`/`uploadUrl`/`eventSourceUrl` are structurally required by `JmapSession` but functionally unused by anything the calendar client calls today (no blob/attachment methods, no push) — implement as valid-shaped but effectively-unreachable routes (`501`), not as full features. `state` (top-level session state, distinct from per-type state) can be a static constant or a hash of server version; the client only reacts to it changing between requests (`onSessionStateChange`), which never happens if it's constant — acceptable for v1.

### 3. Batch endpoint + method dispatch

`POST /api/v1/jmap` (matches `apiUrl` above). Request body: `{using: string[], methodCalls: [name, args, callId][]}`. **Must always return HTTP 200** for any structurally valid batch, even when individual method calls fail — `JmapClient.request()` only throws `JmapRequestError` on `!response.ok`; a non-2xx here would be misdiagnosed as a transport failure, not a method error, breaking the client's error-handling paths (`JmapMethodError`/`JmapSetItemError` construction depends on receiving a 200 with an `error` invocation inside `methodResponses`). Reserve non-2xx strictly for malformed JSON, missing `methodCalls`, or unsupported `using`.

Dispatch algorithm, processing `methodCalls` **in order** (later calls may reference earlier results):

1. For each `[name, args, callId]`, resolve ResultReferences: for every key in `args` starting with `#`, look up the prior `methodResponses` entry whose `callId` matches `args[key].resultOf` and whose method `name` matches `args[key].name`; apply `args[key].path` as a JSON Pointer (RFC 6901) against that response's args object; set `args[key.slice(1)] = <resolved value>`; delete the `#`-prefixed key. If resolution fails (no matching prior call, path doesn't resolve, wrong type), respond `["error", {"type": "invalidResultReference"}, callId]` for this call and continue to the next (error-type string confirmed against RFC 8620 §3.7). Per the same section, if `args` contains both `#foo` and `foo`, respond `["error", {"type": "invalidArguments"}, callId]`. The only back-reference the shipped client ever sends is `"#ids"` with `path: "/ids"` on a `CalendarEvent/query` → `CalendarEvent/get` pair, but implement the general algorithm — it is barely more code.
2. Route by `name` to the table below. Unknown method name → `["error", {"type": "unknownMethod"}, callId]`.
3. Any `ApiHttpException` (or equivalent) thrown by the underlying service → map via the error table below to a method-level `error` invocation (never a raw HTTP error — see point above).
4. Collect all responses into `methodResponses`, echo `sessionState` (same constant as the Session resource `state`, or recomputed the same way).

Method dispatch table (all calls reuse **existing, unmodified** service methods except where noted):

| JMAP method | Backend call | Notes |
|---|---|---|
| `Calendar/get` | `CalendarRepository::list($username)`, filtered to `args.ids` if given | Wrap in `GetResponse` shape: `{accountId, state, list, notFound}`; `state` composed with the envelope codec (§4) over calendar sync tokens |
| `Calendar/changes` | New: diff `calendarSyncTokens($username)` against decomposed `sinceState` | See §4 below — same algorithm as `CalendarEvent/changes`, one level up (calendar existence, not event existence) |
| `Calendar/set` | `CalendarRepository::create/update/delete` (existing methods) | Wrap in `SetResponse` shape; map exceptions to `notCreated`/`notUpdated`/`notDestroyed` the same way `CalendarEventSetService::errorShape()` already does. Client supports this method but the adapter never calls it — needed for API completeness, not the happy path |
| `CalendarEvent/get` | New thin wrapper: if `args.ids` given, call `CalendarEventRepository::show()` per id (`CalendarEventRepository.php:552-565` — no multi-id method exists, the loop lives in the dispatcher); else enumerate all owned VEVENT calendars via `calendarSyncTokens()` and list events per calendar | `state` composed with the envelope codec (§4) — **not** `composeCalendarState()`, whose single-calendar output is not decomposable |
| `CalendarEvent/changes` | New: account-wide fan-out — see §4 | The one method needing genuinely new logic |
| `CalendarEvent/set` | `CalendarEventSetService::set()` (existing, unmodified) — **but** the envelope must implement top-level `ifInState` itself (compare `args.ifInState` against the envelope-codec-composed current account state **before** calling the service; on mismatch, respond `["error", {"type": "stateMismatch"}, callId]` and do not call the service at all — do not thread `ifInState` into the existing per-record mechanism) | `created`/`updated`/`destroyed`/`not*` and per-item shapes are already RFC 8620-correct (`CalendarEventSetService.php:34-79,259-278`) — pass through verbatim. **Top-level `oldState`/`newState` must NOT be passed through**: the service scopes them to touched calendars and collapses a single calendar to a bare token (`resolveSetStates()`, `:91-111`), which the client would later feed back as an undecomposable `sinceState`. The dispatcher recomposes both account-wide with the envelope codec — see §4/§5 |
| `CalendarEvent/query` | `CalendarEventRepository::query()` (existing, unmodified) | Inject `filter.inCalendars = <all owned VEVENT calendar uris>` when the client omits it **before** calling the repository — the 400 is thrown inside `resolveQueryCalendars()` (`CalendarEventRepository.php:192-194`), not only in the FormRequest, so bypassing validation is not enough. Recompose `queryState` with the envelope codec for consistency (harmless either way — the client never feeds `queryState` back, `queryChanges` being unused) |
| `CalendarEvent/queryChanges` | Not implemented | `["error", {"type": "cannotCalculateChanges"}, callId]` (the method *is* part of the advertised calendars capability, so `unknownMethod` would be a compliance lie; `cannotCalculateChanges` is the RFC-sanctioned answer and matches the always-`false` `canCalculateChanges` on query responses). Client never calls it |

### 4. Envelope state codec + `CalendarEvent/changes` fan-out

**The existing state helpers are almost, but not quite, sufficient — and the gap is a blocker (mismatch 13):**

- `CalendarEventRepository::calendarSyncTokens($username): array<uri, synctoken>` (public, `CalendarEventRepository.php:163-177`) already enumerates every owned VEVENT calendar's current Sabre sync token. Reuse verbatim.
- `CalendarEventRepository::composeCalendarState()` (public static, `:143-156`) collapses a **single** calendar to its bare token (`"17"`), losing the uri — that string can never be decomposed back to a `uri => token` map. Fine for the REST layer (per-calendar `/changes` carries an explicit `calendarId`), fatal for account-wide `sinceState` on a one-calendar account, which is the common case.
- `CalendarRepository::parseInstancesState(?string $state): ?array` (private, `CalendarRepository.php:247-269`) parses only the `"{count}:{uri}:{token},..."` form; it returns `[]` for `""`/`"0"` and `null` for anything else that doesn't match — including `"0:"`, which is exactly what the count-prefixed composer emits for zero calendars (`computeInstancesState`, `:237-245`). The empty case does not round-trip today.

**Therefore the envelope owns its state format** — a small codec (new, in the JMAP envelope layer, not on the repositories):

- `composeAccountState(array $tokensByUri): string` — **always** `"{count}:{uri}:{token},..."` sorted by uri, even for 0 or 1 calendars (same shape as `CalendarRepository::computeInstancesState()`). Zero calendars → `"0:"`.
- `decomposeAccountState(?string $state): ?array` — same strict parsing as `parseInstancesState()` (count must match entry count, each entry `uri:digits`), **plus** accepting `"0:"`, `"0"`, and `""` as the empty map. `null` on anything malformed.
- Round-trip property test: `decompose(compose($x)) === $x` for empty, single, and multi-calendar maps.

Every top-level CalendarEvent state string the envelope emits — `CalendarEvent/get.state`, `CalendarEvent/changes.oldState/newState`, `CalendarEvent/set.oldState/newState`, and (for consistency) `CalendarEvent/query.queryState` — is composed with this codec over **all** owned VEVENT calendars (`calendarSyncTokens($username)`). The underlying services' state strings (bare-token single-calendar form; touched-calendar scope in `set()`) are never surfaced at the top level of an envelope response. Per-item `state` values inside `created`/`updated` (per-event tokens from `CalendarEventSetService`) are a different animal and pass through unchanged — the client type tolerates extra properties. The REST layer's wire format is untouched.

Account-wide `CalendarEvent/changes(accountId, sinceState, maxChanges?)` algorithm:

1. `$currentTokens = $this->events->calendarSyncTokens($username)`.
2. `$sinceTokens = decomposeAccountState($sinceState)`; if decomposition fails (malformed token) → `["error", {"type": "cannotCalculateChanges"}, callId]`.
3. For each `uri => token` in `$currentTokens`:
   - If `uri` not in `$sinceTokens` (calendar didn't exist / wasn't visible at `sinceState`): treat every current event in that calendar as `created` (reuse `CalendarEventRepository`'s existing per-calendar listing).
   - Else if `$sinceTokens[uri] !== token`: call the **existing** per-calendar `changes($username, $calendarId, $sinceTokens[uri])` (`CalendarEventRepository.php:408-436`, unmodified) and merge its `created`/`updated`/`destroyed` into the account-wide result.
   - Else: unchanged, skip.
4. For each `uri` in `$sinceTokens` but not in `$currentTokens` (calendar deleted or unshared since `sinceState`): every event id previously recorded for that calendar goes into `destroyed`. The primitive is `JmapCalendarEventStateService::recordedEventIdsForObject()` (`JmapCalendarEventStateService.php:70-79`); the existing usage pattern to mirror is `CalendarEventRepository::destroyedEventIds()` — a **private method on the repository** (`:483-501`), not on the state service as an earlier draft implied.
5. `oldState = $sinceState` (echoed, already validated); `newState = composeAccountState($currentTokens)`; `hasMoreChanges = false` (same honest limitation as the existing per-calendar `/changes` — Sabre's change log can't safely produce a bounded intermediate token); `created`/`updated`/`destroyed` are the merged, deduplicated lists.

This is real new logic (the codec plus the step 3/4 fan-out), but every data-access primitive it calls already exists and is already tested. `Calendar/changes` (collection-level, not event-level) is the same algorithm one level up, operating on calendar existence instead of event existence within a calendar — `CalendarRepository`'s existing `computeInstancesState`/`parseInstancesState` pair is already count-prefixed and account-wide, so the collection-level state may reuse it directly (modulo the `"0:"` empty-case fix, which the envelope codec covers).

### 5. `ifInState` reconciliation and `set` state recomposition

Do not touch the existing per-record `ifInState` behavior in `CalendarEventSetService` (used by the legacy REST `POST /calendars/events/set`, documented as a deliberate divergence in `packages/api/docs/jmap-rest-parity-gaps.md`). The new envelope's `CalendarEvent/set` dispatch implements genuine RFC 8620 §5.3 top-level `ifInState` **independently**: compare `args.ifInState` (when present) against `composeAccountState(calendarSyncTokens($username))` — both sides in the envelope codec — before calling the service; on mismatch respond `["error", {"type": "stateMismatch"}, callId]` without calling the service. The two mechanisms don't need to be unified; they serve different entry points.

On success, the dispatcher passes the service's `created`/`updated`/`destroyed`/`notCreated`/`notUpdated`/`notDestroyed` through verbatim but **replaces** the top-level `oldState`/`newState`: capture `composeAccountState(calendarSyncTokens($username))` before and after the service call. Rationale (mismatch 13): the service's own values are touched-calendar-scoped and single-calendar states collapse to a bare token (`resolveSetStates()`, `CalendarEventSetService.php:91-111`); the client stores `newState` and later replays it as `sinceState` to account-wide `CalendarEvent/changes`, where a pass-through value would fail decomposition (→ `cannotCalculateChanges` → the adapter's `#refetchAll()` full refetch after *every* write on a single-calendar account) or, in the multi-calendar case, silently mislabel untouched calendars as newly visible.

### 6. `myRights` mapping (Calendar/get, Calendar/set)

Sabre's ACL is coarser (3 levels: `access=2` read-only, `access=3` read-write, default owner — `CalendarRepository.php:284-288`; note the backend's `mayShare` is currently *always* `false` and owner `mayDelete` is `uri !== 'default'`) than the JMAP calendars-draft's 8-property `CalendarRights`. Proposed mapping (approximation is unavoidable; refine only if finer-grained ACLs are added later):

| Sabre `access` | mayReadFreeBusy | mayReadItems | mayWriteAll | mayWriteOwn | mayUpdatePrivate | mayRSVP | mayShare | mayDelete |
|---|---|---|---|---|---|---|---|---|
| `2` (read-only) | true | true | false | false | false | false | false | false |
| `3` (read-write) | true | true | true | true | true | true | false | false |
| owner (default) | true | true | true | true | true | true | false | `uri !== 'default'` |

### 7. Error vocabulary

Method-level errors (`["error", {type, description?}, callId]`, RFC 8620 §3.6.2): `unknownMethod`, `invalidArguments`, `invalidResultReference`, `stateMismatch`, `cannotCalculateChanges`, `accountNotFound`, `serverFail`. SetError types (inside `notCreated`/`notUpdated`/`notDestroyed`, RFC 8620 §5.3): reuse `CalendarEventSetService::errorShape()` verbatim (`notFound`, `invalidProperties` + `properties`, `forbidden`, `stateMismatch`, `serverFail` — already camelCase and correct per the prior compliance review; note unknown `ApiHttpException` codes currently pass through as `$e->errorCode()`, so the dispatcher should normalize anything outside the RFC vocabulary to `serverFail` rather than inventing new types).

### 8. Event id charset — documented deviation

Composite event ids for multi-VEVENT objects are `{objectId}#{veventUid}` (`CalendarConversionSupport::compositeEventId`); `#` is outside the JMAP `Id` charset (RFC 8620 §1.2). **Decision: pass ids through unchanged and document the deviation.** Rationale: the shipped client treats ids as fully opaque (`JmapId` is a bare `string` alias, never validated anywhere in `packages/jmap-client/src`), so nothing breaks; encoding at the envelope boundary (e.g. base64url) would require bidirectional translation across `args.ids`, `create`/`update`/`destroy` keys and arrays, every `changes` list, and query back-references — and would break id parity with the REST layer and the `jmap_calendar_event_states` bookkeeping for zero practical gain. Calendar ids (instance uris, `[a-z0-9_-]+`) and account ids (§1) are already charset-legal. Revisit only if a strict third-party JMAP client becomes a target; record the deviation in the Chunk G docs alongside the existing per-record-`ifInState` divergence note.

## Edge cases

- `sinceState` decomposition failure (malformed, or from a different account/tampered) → `cannotCalculateChanges`, matching existing per-calendar behavior. On receiving that error the adapter falls back to `#refetchAll()` (`refreshCalendars()` + `loadRange()` of the last range) — correct but expensive, which is why §4/§5 exist.
- A calendar becomes newly visible (shared) between `sinceState` and now → all its events appear as `created`, not as a separate "calendar created" signal mixed into event changes.
- `CalendarEvent/get` with `args.ids: null` (get-all) on an account with zero calendars → `list: []`, `state = composeAccountState([]) = "0:"`, and a subsequent `CalendarEvent/changes` with `sinceState: "0:"` must decompose to the empty map (the envelope codec accepts it; note the *existing* helpers do not round-trip this case — `parseInstancesState("0:")` returns `null` because its regex requires content after the colon).
- Batch containing a `CalendarEvent/query` immediately followed by `CalendarEvent/get` via `"#ids"` where the query itself failed (method-level error) — the back-reference must fail with `invalidResultReference`, not silently resolve to an empty/undefined ids list.
- `maxCallsInRequest`/`maxObjectsInGet`/`maxObjectsInSet` limits from the Session resource should be enforced by the dispatcher (reject oversized batches with a method-level `requestTooLarge`/`limit` error per RFC 8620 §3.6.1) — not strictly required for the existing client's usage pattern (max 2 calls per batch today) but cheap to add and part of genuine compliance.

## Resolved verification items (2026-08-13 refinement pass)

The original proposal deferred four facts to implementation time; all four are now settled — do not re-litigate:

1. **Calendars capability object** (draft-ietf-jmap-calendars-27 §1.5.1): the session-level `urn:ietf:params:jmap:calendars` value is an **empty object**; the account-level `accountCapabilities` object must contain `maxCalendarsPerEvent`, `minDateTime`, `maxDateTime`, `maxExpandedQueryDuration`, `maxParticipantsPerEvent`, `mayCreateCalendar` (see §2 — the original draft of this spec had the placement inverted).
2. **ResultReference failure error type**: `invalidResultReference`, confirmed against RFC 8620 §3.7. Same section: `#foo` + `foo` both present → `invalidArguments`.
3. **`composeCalendarState([])` returns `"0:"`** — and `parseInstancesState("0:")` returns `null`, i.e. the existing pair does not round-trip the empty case. Handled by the envelope codec (§4).
4. **Complete client method inventory** (re-grepped `lit-calendar/packages/jmap-client/src`): `Calendar/get`, `Calendar/changes`, `Calendar/set`, `CalendarEvent/get`, `CalendarEvent/changes`, `CalendarEvent/set`, `CalendarEvent/query`, `CalendarEvent/queryChanges` — nothing outside the dispatch table. `queryChanges` is exposed but never invoked by the adapter or tests; `Calendar/queryChanges` does not exist client-side.

## Acceptance / compliance verification plan

The compliance oracle is the **unmodified** shipped client, not a new test suite written against this spec:

1. Point a real (non-mocked) `JmapClient` instance from `lit-calendar/packages/jmap-client` at this backend in an integration test (either add one to `lit-calendar` against a running `sabre-installer` test instance, or write the equivalent request/response fixtures backend-side and assert byte-for-byte against what `JmapCalendarsClient`'s methods actually send/parse — read `src/tests/client.test.ts` and `src/tests/adapter.test.ts` for the exact request/response pairs already exercised against `MockJmapServer` at `src/mock/MockJmapServer.ts`, and replicate those as backend feature tests). The live-instance variant is pure configuration on the client side: absolute `sessionUrl`, `headers: {Authorization: "Bearer <jwt>"}` (or a custom `fetch`) — both existing `JmapClientOptions`; no client code changes. It depends on the Session resource emitting absolute URLs (§2), since the client performs no base-URL resolution.
2. `JmapEventsAdapter.initialize()` → `refreshCalendars()` → `loadRange()` → `sync()` → `create()`/`update()`/`remove()` → `flush()` exercised end-to-end against the real backend, no client code changes. The write-then-sync leg specifically covers mismatch 13: after `flush()`, the next `sync()` must take the incremental `/changes` path (no `cannotCalculateChanges` → `#refetchAll()` fallback) — assert that, it is the regression this spec's §4/§5 exist to prevent.
3. Existing `packages/api` done-gate (`composer done-gate` — greenfield-guard, architecture suite, full PHPUnit) must stay green — this work must not regress the existing REST endpoints, which remain in place unchanged.
