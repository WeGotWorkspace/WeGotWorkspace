# Meet chat live client (chunk E)

Client-side wiring for persistent Meet chat: typed REST client, Dexie hybrid
`MeetChatOperations`, JMAP inbound poll, and the mock-vs-live api source + hook.
Mirrors the Notes/Tasks hybrid pattern (`notes-api-source.ts` / `use-notes-api.ts`
/ `notes-hybrid-operations.ts`).

Spec: `.agents/specs/701-meet-chat-backend/spec.md` (Epic #701, Task #704).

## Module map

| Module | Role |
|--------|------|
| `src/lib/api/wgw/meet-chat.ts` | Typed REST client for the 13 `/chat/*` operations (generated `@wgw-api-generated/chat-types`), wire→app mapping |
| `src/lib/api/wgw/meet-chat-jmap.ts` | JMAP client factory (`POST /jmap` through `wgwFetch`) |
| `src/lib/jmap-client/chat/` + `adapter/JmapChatAdapter.ts` | `ChatChannel`/`ChatMessage` `/changes` → `/get` inbound poll |
| `src/lib/offline/meet-chat/meet-chat-schema.ts` | Dexie tables (domain `meet-chat`, version block 60–69) |
| `src/lib/offline/meet-chat/chat-ulid.ts` | Client-side ULID generator for message ids |
| `src/lib/offline/meet-chat-offline-store.ts` | Dexie cache, sync tokens, backfill markers, outbox enqueue/coalescing |
| `src/lib/offline/meet-chat-outbox-flush.ts` | Outbox replay on reconnect |
| `src/lib/offline/meet-chat-inbound-sync.ts` | REST changes-feed inbound + full-history backfill |
| `src/lib/offline/meet-chat-jmap-inbound.ts` | Dexie ingest for remote objects (pending-write protection) |
| `src/lib/offline/meet-chat-hybrid-operations.ts` | `MeetChatOperations` implementation + hybrid bootstrap |
| `src/meet-core/src/meet-chat-api-source.ts` / `use-meet-chat-api.ts` | Mock vs live source (`wgwLiveApiEnabled()`) + workspace hook |

## Dexie schema

Domain `meet-chat`, Dexie version **60** (allocated block 60–69 in
`offline-version-allocation.ts`), on top of the core `{ meta, outbox }` baseline:

- `meet_chat_channels`: `"id"` — rows `{ id, data }`; `data` is the **wire**
  `ChatChannel` JSON (so `dm` collections survive round-trips for chunk G even
  though the `MeetChannel` UI type only models `channel|meeting`).
- `meet_chat_messages`: `"id, channelId, pendingSync, createdAt"` — rows
  `{ id, channelId, data, pendingSync, createdAt }`; `data` is the app
  `ChatMessage` JSON, `createdAt` epoch ms.

Meta keys: `meet-chat:session`, `meet-chat:rtc`,
`meet-chat:state:__channels__` (channel changes token),
`meet-chat:state:{channelId}` (per-channel message changes token),
`meet-chat:cursor:{channelId}` (max ingested message ULID — REST `since` cursor),
`meet-chat:backfill:{channelId}` (full-history backfill done marker).

## Outbox replay design

Ops (domain `meet-chat`), replayed oldest-first by `flushMeetChatOutbox`:

- **send** `{ messageId, channelId, body, parentId }` — the client-generated
  ULID is the idempotency key; retries return the existing message. A queued
  edit for the same ULID merges into the queued send (edit-before-create would
  404); a queued delete for a never-synced ULID cancels the send entirely.
- **edit** `{ messageId, body }` — later queued edits replace earlier ones
  (LWW, matching the server SEQUENCE rule).
- **delete** `{ messageId }` — tombstone; 404 on replay counts as success.
- **react** `{ messageId, emoji }` — a queued toggle for the same
  `(messageId, emoji)` cancels out at enqueue time (toggle twice = net zero
  under the server's `(emoji, author)` OR-set semantics), so replay never
  double-toggles.
- **readMarker** `{ channelId, lastReadTs, lastReadUid }` — latest per channel
  wins at enqueue; PUT is naturally LWW.

Channel create/patch/shareWith are **pass-through** (online-only, cache updated
from the response) — matching the spec's Notes-style handling of collection
metadata. Failed rows stay queued with `retries`/`lastError`
(`markOutboxError`); auth errors (401/403) and semantic 4xx throw to the caller
instead of queueing; network errors and 5xx queue.

Inbound never clobbers local writes: rows with `pendingSync` **or** any id
referenced by a queued outbox row are skipped by the ingest functions until the
flush lands.

## Inbound sync

- **Live poll (primary):** `JmapChatAdapter` polls `ChatChannel/changes` +
  `ChatMessage/changes` every **4s** (spec: 3–5s), follows `hasMoreChanges`,
  fetches changed ids via `/get`, ingests into Dexie.
  `cannotCalculateChanges` → full `/get` snapshot → `reconcileMeetChatSnapshot`.
- **REST fallback (reconnect / refresh / first bootstrap):**
  `syncMeetChatInboundFromRest` — channel changes feed, then per-channel message
  changes. New messages page in via the ascending `since` ULID cursor; edits or
  tombstones of **old** messages force a full channel re-list because the REST
  surface has no message-by-id GET (deliberate: the JMAP path is the efficient
  live channel).
- **Backfill:** first sight of a channel pages the **entire** history with the
  `before` ULID cursor (200/page) into Dexie, then primes the changes token —
  local-first reads with history available offline, per the spec.

## JMAP contract assumptions (chunk D must verify)

The server-side `urn:wgw:jmap:chat` methods did not exist when this client was
built. Everything below is built strictly against the Notes-pattern method
shapes (`urn:wgw:jmap:notes`, `JmapAccountStateCodec` fan-out) and must hold —
or this file and the client must change together:

1. **Capability + session:** the JMAP session lists `urn:wgw:jmap:chat` in
   `capabilities` and provides a `primaryAccounts["urn:wgw:jmap:chat"]` account
   id (mirrors `NOTES_CAPABILITY`). A session without the capability makes
   `JmapChatAdapter.initialize()` throw; the hook degrades to the REST path.
2. **Method names:** `ChatChannel/get`, `ChatChannel/changes`, `ChatMessage/get`,
   `ChatMessage/changes` — RFC 8620 standard `/get` (`ids: null` = all,
   `ids: []` = state-only envelope) and `/changes` (`sinceState`,
   `created/updated/destroyed`, `newState`, `hasMoreChanges`) argument/response
   shapes. The client never calls `ChatChannel/set` / `ChatMessage/set`
   (mutations stay REST), but chunk D ships them per the spec.
3. **Object shapes:** JMAP `ChatChannel` and `ChatMessage` objects use the
   **same field names and value encodings as the REST OpenAPI schemas**
   (`openapi/schemas/chat/` → `ChatChannel`, `ChatMessage`): notably `id`
   (channel uri / message ULID), `channelId`, `authorId`, `authorName`, `body`,
   `createdAt`/`editedAt`/`deletedAt` as UTCDate strings, `parentId`,
   `replyCount`, `reactions[{emoji, authors}]`, `mentions[{id, displayName}]`,
   and channel `kind`/`scope`/`groupSlug`/`shareWith`/`isSharee`/`myRights`/
   `topic`/`guestRoomCode`/`memberCount`/`unreadCount`. The client casts JMAP
   objects to the generated REST types (`use-meet-chat-api.ts`).
4. **Account-wide message state:** `ChatMessage/changes` covers **all channels
   the account can read** (the `JmapAccountStateCodec` fan-out over channel
   collections, exactly like `Note/changes` over notebooks). Consequently:
   - a reaction/edit/tombstone anywhere surfaces as an `updated` message id;
   - a message delete is a **tombstone** (`STATUS:CANCELLED` → `deletedAt`
     set, body empty) and arrives as `updated`, *not* `destroyed`; `destroyed`
     is reserved for hard removals (e.g. channel purge);
   - when a channel is newly shared to the account, its channel id appears in
     `ChatChannel/changes.created` — the client then runs a one-time REST
     history backfill for that channel (it does **not** assume the messages
     replay through `ChatMessage/changes.created`).
5. **`hasMoreChanges` is real** (never hardcoded false, unlike Notes): the
   adapter follows up to 20 pages per tick and the REST sync loops the same way.
6. **`cannotCalculateChanges`:** returned as a standard JMAP method-level error
   with `type: "cannotCalculateChanges"` when the change log was pruned → the
   client refetches everything and reconciles. The REST changes endpoints
   signal the same condition with an error body `{ "code":
   "cannotCalculateChanges" }` (mirrors `/notes/*/changes`).
7. **State tokens are opaque strings**; the client stores them per type
   (channels) and per channel (messages, REST path) and never inspects them.

## REST contract assumptions (chunks B/C)

1. `POST /chat/channels/{id}/messages` with an already-used client ULID is
   **idempotent**: returns the existing message (2xx), not a conflict — this is
   what makes outbox send-replay safe.
2. `GET /chat/channels/{id}/messages` without cursors returns the **newest**
   window; `before` pages older history; `since` pages newer messages
   ascending; within one response `list` is ascending `(createdAt, id)`.
   Responses reflect **current** message state (edits/reactions included).
3. `DELETE /chat/messages/{id}` is an idempotent tombstone; deleting an
   already-deleted message is not an error (or 404, which the client also
   treats as success).
4. Reaction toggle POST returns the **full updated message**.
5. Errors are JSON with an optional `code` field; 404 means the target object
   (or its channel) is gone and local state may be dropped.

## Not in chunk E (owned elsewhere)

- `MeetWorkspace` composition, `startCall` RTC wiring, `/meet` route flip —
  shipped as chunk F: `meet-core/src/meet-chat-app.tsx` (`MeetChatApp`),
  `use-meet-chat-call.ts` (controller → stage + call ops),
  `meet-channel-room.ts` (deterministic room id = channel id;
  meeting channels keep `guestRoomCode`),
  `use-meet-channel-call-activity.ts` (`callActive` room-status polling).
- DM rail + unread badges (dm rows are cached but filtered out of
  `MeetUIData.channels`) — chunk G.
- Read-marker UI calls (the outbox op + REST op exist and are tested) — chunk F/G.
- Server JMAP methods — chunk D (verify against this file).
