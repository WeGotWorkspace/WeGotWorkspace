# JMAP transport envelope (calendars)

A genuine RFC 8620 JMAP-over-HTTP transport in front of the same calendar services the REST layer uses, so a spec-faithful JMAP client (specifically the shipped `@lit-calendar/jmap-client`, separate repo) can talk to this backend with **zero client-side changes**. The REST endpoints (`docs/calendars/jmap-calendars-summary.md`) are unchanged; the envelope is an **additive third protocol adapter** next to REST and CalDAV — one database, one process, three fronts.

Spec: `.agents/specs/000-jmap-envelope-calendars/` · Tests: `tests/Feature/Jmap/`, `tests/Unit/Jmap/` · Live-client testing: [jmap-client-e2e.md](./jmap-client-e2e.md)

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/v1/jmap/session` | Session resource (RFC 8620 §2) |
| `POST /api/v1/jmap` | Batched method calls (§3) |
| `GET /api/v1/jmap/download/{accountId}/{blobId}/{name}` | Blob download (RFC 8620 §6.2, #438) — serves envelope-store ids (`jb-…`) **and** contacts REST blob-store ids; `type` query param overrides Content-Type |
| `POST /api/v1/jmap/upload/{accountId}` | Blob upload (§6.1, #438) — content-addressed (sha-256), dedupes per account, TTL-expiring unless domain-referenced; enforces the advertised `maxSizeUpload` |
| `GET /api/v1/jmap/events/{types}/{closeafter}/{ping}` | 501 stub — Push is a non-goal; the client polls |

All behind `wgw.auth` + `wgw.role:user` — deliberately **outside** any domain feature-gate middleware (#436). Domain availability is expressed through the advertised capabilities and the `using` guard (`JmapCapabilitySet` + per-domain `JmapCapabilityProviderInterface` providers): a gated-off domain (e.g. `calendar_enabled: false`) is absent from the Session resource, rejected in `using` with a request-level `unknownCapability`, and its methods are `unknownMethod` — the envelope itself stays up for the other domains.

## Session resource

- **One account per authenticated principal; `accountId` = the raw username.** Usernames (`^[a-z0-9][a-z0-9_-]{1,62}$`) are a strict subset of the JMAP `Id` charset — no encoding. `primaryAccounts` maps both `urn:ietf:params:jmap:core` and `urn:ietf:params:jmap:calendars` to it.
- **Capability placement per draft-ietf-jmap-calendars-27 §1.5.1:** the session-level calendars capability is the **empty object**; the six-property object (`maxCalendarsPerEvent: 1`, `minDateTime`, `maxDateTime`, `maxExpandedQueryDuration`, `maxParticipantsPerEvent`, `mayCreateCalendar`) lives in `accountCapabilities`.
- **All URLs are absolute** (built from the request): the client fetches `apiUrl` verbatim with no base-URL resolution.
- `state` is derived: the `JmapCapabilities::SESSION_STATE` document version plus a digest of the enabled capability URNs (`JmapCapabilitySet::sessionState()`), echoed as `sessionState` on every `POST /jmap` response. Toggling a domain feature gate changes the session document, so the state changes with it (RFC 8620 §2); the client reacts via `onSessionStateChange`.
- Advertised limits are enforced: `maxCallsInRequest` (32, request-level `urn:ietf:params:jmap:error:limit`), `maxObjectsInGet` (500) and `maxObjectsInSet` (200) (method-level `requestTooLarge`), `maxSizeRequest`, and `maxSizeUpload` (config `wgw.jmap.max_size_upload`, default 25 MB, enforced by `POST /jmap/upload` — #438).

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
| `AddressBook/get` | `AddressBookRepository::list()` | REST already emits the RFC 9610 shape incl. the 4-property `AddressBookRights` — no remapping (#437) |
| `AddressBook/changes` | `AddressBookRepository::syncTokens()` | Existence/token diff via the envelope codec; card activity over-reports books as `updated` (same Sabre behavior as calendars) |
| `AddressBook/set` | `AddressBookRepository::create/update/delete` | Top-level `ifInState`; `onDestroyRemoveContents` → `addressBookHasContents` SetError when refused; `onSuccessSetIsDefault` → `invalidArguments` (default book is fixed) |
| `ContactCard/get` | `ContactCardRepository::show()` per id / `list()` per book | Multi-id loop lives in the dispatcher; per-card `state` tokens attached by the mapper |
| `ContactCard/changes` | per-book `ContactCardRepository::changes()` | Account-wide fan-out (same algorithm as `CalendarEvent/changes`); deleted books expand via `JmapContactStateService::recordedCardIdsForBook()` |
| `ContactCard/set` | `ContactCardSetService::set()` | True top-level `ifInState`; **legacy shapes normalized at the adapter**: `created` id-strings → `{id, state}`, `updated` state-strings → `{state}`, snake_case error types → RFC vocabulary (`JmapSetErrors::fromLegacyShape()`); REST untouched |
| `ContactCard/query` | `ContactCardRepository::query()` per book | Book-less filters fan out over all owned books; supported conditions `inAddressBook` + `uid`, everything else → `unsupportedFilter`; non-empty `sort` → `unsupportedSort` (backing query only orders by id) |
| `ContactCard/queryChanges` | — | Always `cannotCalculateChanges`, same rationale as calendars |
| `FileNode/get` | `FileNodeIndexService` + `FileNodeMapper` (#450) | Node-identity index over the drive; get-all reconciles the visible tree (lazy self-heal); supports draft-14 `fetchParents` |
| `FileNode/changes` | global change sequence + tombstones | State = bare sequence number (not the Sabre codec); pruned tombstones → `cannotCalculateChanges` |
| `FileNode/set` | `FileNodeSetService` (disk + index) | Top-level `ifInState`; `onExists` null/`replace`/`rename`/`newest`; `onDestroyRemoveChildren` → `nodeHasChildren` when refused; `alreadyExists` carries `existingId`; content via uploaded `jb-` blobs (copy-on-consume) |
| `FileNode/copy` | — | Single account per principal: same-account → `invalidArguments` (RFC 8620 §5.4), other → `fromAccountNotFound` |
| `FileNode/query` | node index | Supported filters `isTopLevel`/`parentId`/`ancestorId`/`nodeType`/`name`/`nameMatch` + `depth` recursion; sorts `name`/`nodeType`; rest → `unsupportedFilter`/`unsupportedSort` |
| `FileNode/queryChanges` | — | Always `cannotCalculateChanges`, same rationale |

Method-level error vocabulary (§3.6.2): `unknownMethod`, `invalidArguments`, `invalidResultReference`, `stateMismatch`, `cannotCalculateChanges`, `accountNotFound`, `forbidden`, `requestTooLarge`, `unsupportedFilter`, `unsupportedSort`, `serverFail`. SetError types reuse the REST layer's camelCase vocabulary (calendars) or are normalized from the legacy snake_case shapes at the adapter layer (contacts); unknown internal codes normalize to `serverFail` instead of inventing types.

Contacts states compose over address-book sync tokens (`AddressBookRepository::syncTokens()`) with the same `JmapAccountStateCodec`; calendar and contacts states never mix (pinned in `JmapContactsClientContractTest`). FileNode states are a **bare global sequence number** from the node index (`jmap_file_node_meta.seq`) — a different substrate needs a different codec (pinned in `JmapFileNodesClientContractTest`). The index is maintained from both write paths (`DriveService` + the DAV `FileNodeIndexPlugin`), reconciled lazily on reads, and rebuilt with `php artisan wgw:jmap:filenodes-reindex`.

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

Sabre's 3-level access maps onto the draft's 8-property `CalendarRights` (`CalendarRightsMapper`). **`myRights` on a sharee instance** is not the same object as an owner's `shareWith` grant:

| Surface | Sabre `access` | mayReadFreeBusy | mayReadItems | mayWriteAll | mayWriteOwn | mayUpdatePrivate | mayRSVP | mayShare | mayDelete |
|---|---|---|---|---|---|---|---|---|---|
| Sharee instance (`Calendar/get` `myRights`) | `2` (read-only) | true | true | false | false | false | false | false | true (hide) |
| Sharee instance (`Calendar/get` `myRights`) | `3` (read-write) | true | true | true | true | true | true | false | true (hide) |
| Owner instance (`Calendar/get` `myRights`) | owner (personal) | true | true | true | true | true | true | true | `uri !== 'default'` |
| Owner instance (`Calendar/get` `myRights`) | owner (group) | true | true | true | true | true | true | true | `uri !== 'default'` (provisioned group calendars cannot be deleted) |
| Owner `shareWith` grant | `2` (read-only) | true | true | false | false | false | false | false | false |
| Owner `shareWith` grant | `3` (read-write) | true | true | true | true | true | true | false | false |

Sharee `mayDelete: true` means the sharee can hide the collection from their list (REST/JMAP destroy dismisses; the owner's grant is unchanged). Owner `shareWith` grants stay `mayDelete: false` — that flag is not a hide right.

## Documented deviations

- **Event id charset:** composite multi-VEVENT ids are `{objectId}#{veventUid}`; `#` is outside the JMAP `Id` charset (RFC 8620 §1.2). Ids pass through unchanged — the shipped client treats ids as opaque strings, and encoding at the boundary would break id parity with REST and the state bookkeeping for zero practical gain. Revisit only if a strict third-party client becomes a target.
- **Push** (RFC 8620 §7) is not implemented; `eventSourceUrl` is a 501 stub. The shipped client polls.
- **`createdIds`** request/response maps are ignored/omitted (the client never sends them).
- **Update payloads are plain partial objects**, not RFC 8620 PatchObjects with `/`-separated paths — matching what the shipped adapter sends and what the underlying set service accepts.
- **Contact photo blobs**: `media` blobIds resolve from the contacts REST blob store **or** the envelope blob store (#438 superseded the #437 deviation) — clients may upload photos through `POST /jmap/upload` or `POST /contacts/blobs`; on read, media surfaces contacts-store ids that download through the envelope endpoint.
- **Blob GC**: unreferenced envelope blobs expire after `wgw.jmap.blob_ttl_hours` (default 24h; re-upload refreshes); `php artisan wgw:jmap:blobs-gc` deletes expired blobs unless a registered domain reference checker (`JmapBlobGarbageCollector::CHECKERS` — the filenode seam) claims them. Contacts registers no checker: card media is copied into the vCard on write.
- **`ContactCard/query` sorting** is not supported (`unsupportedSort`); RFC 9610 says servers MUST support `created`/`updated` sorts — deferred until the backing query grows ordering, rather than silently returning wrongly-ordered results.
- **FileNode (#450, draft-ietf-jmap-filenode-14 pinned):** out-of-band renames (direct disk writes) are indistinguishable from delete+create, so the node id changes — inherent to indexing a plain filesystem. Shared-with-me subtrees are deferred (visible set = own tree + member group trees); `.notes/` (and `.archive` under it) and `.Trash` are FileNodes while other dot-file internals are not; Drive browse still hides `.notes`; no symlink nodes; no client-controlled `modified`/`accessed` timestamps (`modified` is accepted on create only for `onExists: "newest"` comparisons); `FileNode/copy` is unusable with one account per principal; content blobIds are node-derived (`fnb-…`, streamed from disk, change with content) and `FileNode/set` consumes uploaded `jb-` blobs by copying bytes into the file — no blob-GC reference checker needed.
