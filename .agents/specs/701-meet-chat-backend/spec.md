Source: #701 (body-hash: d8ff6cc8)
Goal: #686

# Meet chat backend + live workspace

Technical translation of Epic #701. Product context: Goal #686 (chat in named Meet channels and start a call from the same place). Frontend surface delivered under Epic #687 / Task #688 (`.agents/specs/688-meet-chat-ui/`). Child Tasks: #702–#709.

## Goal

Persist Meet channels and messages on the existing Sabre CalDAV + VJOURNAL stack (full ACL/sharing reuse), expose them via REST (`/api/v1/chat/`) and a vendor JMAP capability (`urn:wgw:jmap:chat`), wire the already-built `MeetWorkspace` to live data through the Notes/Tasks hybrid-Dexie pattern, and flip live `/meet` to the new Slack-like shell with calls on the existing WebRTC signaling. DMs, server-enforced knock policy, typing indicators, old-shell retirement, and a calendar conferencing-link picker complete the Epic.

## Architecture decisions

### VJOURNAL storage — a deliberate trade, with a hard condition

Messages persist as **VJOURNAL objects** in CalDAV channel collections. This is infrastructure reuse, not semantic fit:

- **Buy:** the production-proven ACL/sharing layer (owner/sharee/group ownership, `transferOwner`, dismissals), cursor delta sync via `calendarchanges`, and JMAP state fan-out that already reads that feed. The VJOURNAL-for-user-text pattern already runs live for Notes — known pattern, new payload.
- **Bend:** a chat message is *not* a journal entry. `X-WGW-AUTHOR`, `X-WGW-REACTIONS`, `RELATED-TO`-as-thread-parent, and `STATUS:CANCELLED`-as-tombstone are custom props or reinterpretations; external journal clients would render foreign chat messages as broken "cancelled journal entries". ICS is a serialization format here, nothing more.
- **Condition:** the trade is acceptable **only if** chat collections stay invisible to DAV (next section). If the DAV-exposure filter slips out of scope, the storage choice must be re-discussed — they are one package.
- **Escape hatch:** messages hide behind the repository; they can move to a dedicated table later (channels keep CalDAV for ACL) without touching the client contract.

### DAV exposure — chat collections are API-only

Verified: the DAV server uses a stock `CalDAV\Backend\PDO` (`SabreServerFactory` → `AppCalendarRoot`) with no URI filtering. Fix: subclass the **DAV-server-side backend instance only** to exclude a configurable set of URI prefixes (`chat-`, `dm-`) from `getCalendarsForUser`/home-set enumeration **and deny direct DAV access** by URL (enumeration-hiding alone doesn't stop a client that knows the path; `ICSExportPlugin` included). Precedent: `WebdavWriteGuardPlugin`.

**Notes stay DAV-visible — by design.** Notes are semantically real journal entries; external rendering is coherent, tolerated interop (`docs/architecture/notes.md`). The asymmetry (`chat-`/`dm-` denied, `notes-` allowed on the same server) is a guarded architectural decision: the regression test must assert both sides **and carry an in-test comment explaining why**, so a future "both are VJOURNAL, same rules" generalization can't erode the filter silently.

### Data model

- **Channel = CalDAV collection** (VJOURNAL-only component set), URI prefix `chat-`/`dm-`. Sharing = `CalendarShareInvites` / `CalendarCollectionAccess` / `calendar_share_dismissals`; group ownership = `groupSlug` → `principals/groups/{slug}` with `transferOwner` (identical to `NotebookRepository`). `shareWith`, `isSharee`, `myRights` map 1:1 onto the existing `MeetChannel` type.
- **`chat_channel_meta` side table** (`calendarid`, `kind` channel|meeting|dm, `topic`, `room_code` nullable FK to `meet_reservations`). Precedent: `note_stars`.
- **Message = VJOURNAL object**: `UID` = message id (**ULID, mandated** — client-generated, lexicographically time-sortable → idempotent retries and orderable read markers), `DESCRIPTION` = body, `X-WGW-AUTHOR` = principal, `RELATED-TO` = thread parent, `STATUS:CANCELLED` = delete tombstone, `X-WGW-REACTIONS` = JSON prop rewritten server-side in a transaction. Converter mirrors `NoteJournalConverter`.
- **`SEQUENCE` bumps only on author body edits.** Reaction toggles never touch it — LWW-by-`SEQUENCE` for edits must never interact with reaction mutations (the transaction serializes reactions; they need no version counter).
- **`chat_read_markers`** (`username`, `calendarid`, `last_read_ts`, `last_read_uid`). Ordering source of truth: server-assigned created timestamp with ULID tiebreak — unread = messages with `(created_ts, uid) > (marker.ts, marker.uid)`, own messages excluded. The UID alone is never the comparator, even though ULIDs happen to sort.
- **DM = auto-provisioned 2-person collection** on first message: URI `dm-{a}-{b}` sorted, kind `dm`, peer invited with write access, hidden from the Channels sidebar, surfaced in the DM rail keyed by peer principal.
- **Changes feed is a verified dependency, not an assumption:** sync only works if every message mutation goes through the Sabre calendar backend so `getChangesForCalendar` sees it. Chunk B opens with a red-green spike proving it for `chat-` collections, **including paging semantics at chat volume** (Notes hardcodes `hasMoreChanges: false`; chat cannot).

### Concurrency model — no CRDT

Messages are single-author, append-mostly rows; clients never PUT VJOURNAL blobs with `If-Match`. Every mutation is a semantic operation the server serializes per object (transaction + row lock on the `calendarobjects` row):

- **Create:** append-only, client ULID → idempotent retry.
- **Edit body:** author-only → single writer; LWW by `SEQUENCE` correct by construction.
- **Reactions** (only true multi-writer spot): toggle with `(emoji, author)` set semantics, read-modify-write inside the transaction — concurrent toggles merge like an OR-set. No etag reaches the client.
- **Delete:** idempotent tombstone.
- **Offline outbox** replays the same semantic ops; idempotent/commutative per author, replay order cannot corrupt state.

Channel *metadata* (name, topic, shareWith) keeps Notes-style etag/`ifInState` handling. Known cost: reaction toggles rewrite the object and produce change-feed noise for all clients — accepted for v1 at self-hosted team scale; mitigation would be server-side, without client-contract changes.

### Call access & knocking

- Knock machinery reused as-is: `__wgw_knock__:` name prefix (`MeetSignalingService::KNOCK_NAME_PREFIX`), `knock`/`admit`/`deny` control messages, `meet-knock-badge.tsx`.
- **New policy, server-enforced** (`MeetChannelJoinPolicy`), resolved at join via the channel's Sabre ACL: **channel member (any ACL read access) → joins directly, never knocks, and is a host** — every member can admit/deny. This is an explicit product decision (broad trust model), not an implementation default; admitted guests do not become members, so admit rights are not transitive. **Non-member** (guest sessionKey or internal user off the ACL) → forced onto the knock path; the server rejects direct joins so the API can't be bypassed.
- The new `MeetCallStage` has **no knock/admit UI yet** — porting it is explicit net-new work (Chunk I).
- Calls stay on existing signaling: `startCall(channelId)` resolves/reserves a `meet_reservations` room; join/leave/ICE unchanged; `callActive` from room-status polling in v1.

### Typing indicators — presence-core, never the sync path

Typing rides WebRTC data channels (`presence-core` from PR #690, on `main`): no persistence, no `calendarchanges` rows — the 3–5s JMAP poll is semantically wrong for ephemeral signals. The chat UI has no typing-indicator component yet; UI + wiring is Chunk K.

### API surface (OpenAPI-first, mirrors Notes)

- REST under `/api/v1/chat/`: channels CRUD + `shareWith` PATCH + `groupSlug` transfer; messages list (cursor paging) / send / edit / delete; reaction toggle; read-marker PUT. Schemas in `openapi/schemas/chat/` wired into `openapi.json` → `pnpm --filter @wgw/api typegen`; `OpenApiRouteContractTest` enforces parity.
- JMAP capability `urn:wgw:jmap:chat`: `ChatChannel/get|changes|set`, `ChatMessage/get|changes|set` — new `Methods/*` in `JmapMethodDispatcher::METHODS` + capability provider + `JmapAccountStateCodec` fan-out (exact Notes recipe).
- Edit/delete authorization: **strictly author-only** in v1 (enforced via `X-WGW-AUTHOR`).

### Screen-share parity (route flip)

The capture/publish path exists in current Meet (`use-meet-local-media.ts` `getDisplayMedia` → controller → renegotiation) and the new expanded layout wires the toggle. Parity comes from reusing the same controller in `callStageRoom` — but every stage layout (collapsed / expanded / fullscreen / spotlight) and the guest view must render a remote peer's shared screen (explicit done-when in Chunk F).

### Calendar integration

The calendar event form gains a picker for an existing meeting-kind Meet channel as the event's conferencing link, alongside the ad-hoc generate-link flow (Task #709, Chunk L).

## Non-goals

- CRDT for messages — semantic server-side operations instead.
- Persistent guest messages: guests keep `/meet/join` + ephemeral room chat in v1 (follow-up needs `MeetActorResolver` sessionKey write auth on the channel).
- External link-unfurl service — previews stay client-side.
- Moderation-style deletion of others' messages — fits the rights model but is an explicit deferred product decision.
- Hiding Notes collections from DAV — Notes stay visible by design.
- `lib/rtc` signaling / SDP changes — calls stay on existing Meet signaling.

## Affected packages

- `packages/api` — OpenAPI, migrations, repositories, controllers, DAV filter, JMAP capability, join policy, feature tests
- `packages/apps` — REST client, Dexie hybrid ops, JMAP inbound, live `MeetApp`/`MeetWorkspace` composition, route flip, knock/typing UI, old-shell removal, stories
- docs — `workspace-shells.md`, meet skill, architecture notes

## Technical constraints

- OpenAPI-first: contract (Chunk A) blocks all backend + client chunks; typegen output must compile and `OpenApiRouteContractTest` must pass.
- All message mutations must flow through the Sabre calendar backend (or dual-write like `NoteMoveHelper`) so `calendarchanges` stays authoritative.
- VJOURNAL discrimination is by URI prefix (`chat-`/`dm-` vs `notes-`); notebook queries must not pick up chat collections (regression test).
- Storybook stays mock-tier; `pnpm test:apps-done-gate` before any push touching `packages/apps/**`.
- JMAP inbound poll ~3–5s for chat (vs Notes 10s).

## Edge cases

- Reaction toggles from two users on the same message concurrently → OR-set merge inside the transaction, no lost updates, no `SEQUENCE` bump.
- Read marker with equal timestamps → ULID tiebreak; own messages never count as unread.
- DM URI collision: `dm-{a}-{b}` principals sorted lexicographically; first-message race resolved by unique URI (second create finds the existing collection).
- Internal authenticated user who is not on the channel ACL must knock — server rejects a direct join (no client-side bypass).
- Direct DAV GET/PUT/REPORT on a known `chat-` URL returns 404/403 even though enumeration already hides it; the same operations on `notes-` stay allowed.
- Changes feed paging at chat volume: `hasMoreChanges` must be real, not hardcoded false.
- Guest flow must keep working through the route flip (`/meet/join` + `MeetGuestChannel`), including screen-share rendering.
