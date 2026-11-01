# JMAP Push

Design for telling open apps "data you can see changed, sync now", without WebSockets. It implements JMAP Push over an event source ([RFC 8620 §7](https://www.rfc-editor.org/rfc/rfc8620#section-7)) on top of the change counters the server already keeps. It is the transport half of [notifications.md](notifications.md), which sets the rules for silent and active news. Epic: #1659. Status: **server and client hub built** (#1660, #1661; app adoption and the mesh `check-now` still to do); revised after three external reviews (see [plan.md](../../.agents/specs/1659-live-updates/plan.md#considered)).

---

## Problem

Live editing of a Doc or Note body is instant (Yjs over the RTC mesh), and so is Meet chat for peers on the principal mesh (`meet-core/src/meet-mesh-sot.ts`). Everything else reaches other people only through each app's own poll, or not at all:

| App | How it sees other people's changes today |
|-----|------------------------------------------|
| Notes | JMAP `/changes` every 10 s (`ONLINE_CHANGES_POLL_MS`, `notes-core/src/use-notes-api.ts`) |
| Contacts | same, 10 s (`contacts-core/src/use-contacts-api.ts`) |
| Calendar | background refresh every 10 s (`calendar-core/src/use-calendar-surface.ts`) |
| Meet chat | live over the mesh; JMAP `/changes` every 4 s as the authoritative fallback (`meet-core/src/use-meet-chat-api.ts`) |
| Drive / Docs home | `FileNode/changes` on app start and after a reconnect flush only. No timer. |
| Tasks | reconnect flush and manual `refreshList` only. No online poll. |

All of these polls skip while `document.hidden`. A file a colleague drops in a shared folder does not show up until you reload Drive.

The suite runs on shared hosting with a small PHP-FPM pool ([realtime-capacity.md](../realtime-capacity.md)), so the server cannot hold a connection per browser open.

## The source of truth already exists

Every write already advances a counter that the per-user JMAP `state` strings are built from:

| Data | Counter | Covers |
|------|---------|--------|
| Notes, calendar events, tasks, Meet chat, Docs threads (all VEVENT / VTODO / VJOURNAL in CalDAV) | Sabre `calendars.synctoken` + `calendarchanges` | every write path: DAV clients, REST, JMAP, MCP. `NoteMoveHelper` bumps it directly. |
| Contacts | Sabre `addressbooks.synctoken` + `addressbookchanges` | same; `AddressBookShareInvites` also bumps on share |
| Drive | `jmap_file_nodes.change_seq` (one global sequence, `FileNodeIndexService`) | writes through the file-node index |

The account-wide `state` of a type is already a composite over the collections the user can access, for example `3:work:41,private:17,team:88` (`JmapAccountStateCodec`, and `computeInstancesState` in `NotebookRepository`, `CalendarRepository`, `TaskListRepository`, `AddressBookRepository`). It changes when an item changes, and also when a collection is shared with the user or removed, because the list of instances changes.

So there is no new log and no recipient fan-out on write for CalDAV and CardDAV data. "Did anything change for me?" is: compute my current states, compare with what I last saw.

VJOURNAL is not used as a log. It holds data (note bodies, chat messages, Docs threads). The change logs above are the log, and they already cover those VJOURNAL collections.

## JMAP Push in short

RFC 8620 §7 defines:

- **StateChange:** `{"@type": "StateChange", "changed": {"<accountId>": {"Note": "<state>", "FileNode": "<state>"}}}`. Each value is what `Foo/get` would return as `state` now. The client compares it with its own state and calls `Foo/changes` when it differs.
- **Event source:** `GET {eventSourceUrl}` with `types` (`*` or a list), `closeafter` (`state` | `no`) and `ping` (seconds). The server sends `state` events with a StateChange, and an event `id` that encodes the whole state visible to the user. On reconnect the client sends `Last-Event-ID`. The server uses it to send missed changes at once.

Our JMAP session already advertises `eventSourceUrl` (`JmapSessionController`, template `/api/v1/jmap/events/{types}/{closeafter}/{ping}`). Before #1660 the route answered 501 from a stub; it now serves the endpoint below.

## Server: the event-source endpoint

`GET /api/v1/jmap/events/{types}/{closeafter}/{ping}`, in the existing route group with `wgw.auth`, `throttle:wgw-api` and `wgw.role:user` (bearer token).

1. **Compute** the current state of each requested type for the user, with the same code the `*/get` methods use.
2. **Compare** with the states encoded in `Last-Event-ID`.
3. **Respond** as `text/event-stream` and end the response at once:
   - Something differs → one `state` event with a StateChange holding only the types that differ, then `id: <encoded states>`.
   - Nothing differs → `retry: <ms>`.

### One mode: short-burst

The server never holds a connection open. Signaling already follows that rule, because a shared host has about five PHP-FPM workers, and a held connection per browser would fill them and stall signaling too. `WGW_JMAP_PUSH_RETRY_MS` (default `3000`) sets the client's reconnect interval.

In this form the endpoint is a poll with SSE framing. We keep the RFC event source rather than a plain JSON endpoint: the URL is already advertised in the session, external JMAP clients can use it, and holding connections can come back later on a separate worker pool without changing any client.

### Event id

The id encodes the user's visible state per type, so a reconnect needs no server-side session:

```text
v1;Note=<h>;Notebook=<h>;CalendarEvent=<h>;Calendar=<h>;ContactCard=<h>;AddressBook=<h>;FileNode=<h>;Notification=<h>;...
```

The id is a plain list of independent per-type hashes, never one hash over the whole. `<h>` is a 128-bit hash (32 hex characters) of the type's state for the user. A collision would be a silent, permanent miss, so it is not truncated further. For `FileNode` the hash covers the composite of the user's root markers, while the StateChange value is the global sequence (below). Because the parts are independent, the client can rebuild an id from the hashes it has confirmed ([below](#the-id-is-built-from-confirmed-hashes)). An unknown or malformed id counts as "everything differs": the server sends the current states of all requested types, and the client compares them with its own and only syncs types that really changed.

### Types

| Type | State source | Note |
|------|--------------|------|
| `Note`, `Notebook` | notebook instances + synctokens | existing JMAP types |
| `CalendarEvent`, `Calendar` | calendar instances + synctokens | existing |
| `ContactCard`, `AddressBook` | address book listings + synctokens | existing |
| `ChatMessage`, `ChatChannel` | channel instances + synctokens | existing |
| `FileNode` | a change marker per visible root (below) | existing |
| `Task`, `TaskList` | task list instances + synctokens (`TaskListRepository`) | no JMAP type today. Use the type names from the JMAP Tasks draft, so a later JMAP Tasks surface can keep them. |
| `Notification` | a change marker per principal on `notifications` (below) | WGW type for active news; the client fetches the inbox |

Every state read is O(collections or roots the user can see), never O(changes on the server).

Docs threads also live in `calendarchanges`, but their access comes from the Drive ACL (`DriveShareAuthorizer`), not calendar shares. They are a later slice.

### Drive: a change marker per root

`FileNode/get` returns the global `currentSeq()` as `state`. Pushing that as-is would wake every browser on any file change and show everyone when others are active. Filtering change rows per poll instead (as `changesSince` does) would scale with server-wide write volume. So the server keeps a marker per root:

- **Write:** every Drive write bumps the marker of each root its storage key falls under: the account root (`users/x` or `groups/y`) and every share root that is an ancestor of the key. The share roots are found by looking up the key's ancestor paths, O(depth). One upsert per root touched, not one per person with access, so a group folder with 200 members costs the same as a private one.
- **Move and delete** bump the root set of the old path and of the new path, so a grantee sees an item leave their share.
- **Batch operations** (folder upload, batch move, zip) compute the root set once per operation and bump each root once, not once per file.
- **Missing rows:** a root without a marker row counts as 0, so two equal situations always give the same composite.
- **Read:** the user's roots come from `FileNodeAccountSupport::rootsFor`, which already includes group roots and shares to a single person. The user's push state for `FileNode` is a hash over the sorted list of `root → marker` pairs of those roots: identity and value, so adding or revoking any root changes it, even an empty one at 0. The event id carries that hash. A new share adds a root, so the composite changes.
- **Push value:** the StateChange still carries the global sequence, because that is what `FileNode/changes` expects as `sinceState`. It is only sent when the user's composite changed.

### Inbox: a change marker per principal

The `notifications` table has no change column, and `supersede` rewrites rows in place. It gets a per-principal marker (an `updated_at` or a per-principal sequence) that create, supersede, clear and read all move. The `Notification` state is that marker.

### Rate limit

`wgw-api` is 600/min per account, shared by every tab and device (`WgwApiRateLimiters`). The JWT carries no session id (`sub`, `role`, `iat`, `uid`), so the push route gets its own bucket keyed by user plus the browser id the client already sends for presence (`RtcBrowserId`):

- about 60/min per browser: 20/min of regular reconnects plus up to 30/min of check-now reconnects, with margin;
- a per-account ceiling (for example 300/min), so a client that rotates browser ids cannot escape the limit.

A `429` carries `Retry-After`. The client waits that long and treats push as down meanwhile, so the app polls return to their normal interval. A full bucket never ends in silence. Going offline and back during that wait does not end it early.

### Cost and measurement

Each request boots Laravel and runs a handful of small indexed reads (one per state source, one for the Drive markers). No writes. Rough budget with 5 FPM children and a 3 s retry:

| Browsers open | Requests per minute | at 50 ms each | at 200 ms each |
|---------------|---------------------|---------------|----------------|
| 5 | 100 | ~2% of the pool | ~7% |
| 16 | 320 | ~5% | ~21% |
| 32 | 640 | ~11% | ~43% |

These are estimates, not measurements. The server task extends `tools/load/rtc-shared-hosting.k6.js` with a push scenario and records in `realtime-capacity.md` both sides: the reads (p95 latency split into state resolution per type and the Drive marker read) and the writes (marker upserts on single and batch Drive operations, and after-response Web Push sends), plus the number of busy FPM workers, not only requests per minute. `WGW_JMAP_PUSH_RETRY_MS` is the lever on slow hosts. Once push works, the per-app polls (10 s, chat 4 s, inbox 15 s) can slow down. Their requests are heavier than a push check, so the total can end up lower than today. That is a separate decision after measuring.

## Client: one hub, pluggable transports

```text
                Server: JMAP state per user (source of truth)
                        ▲ GET eventSourceUrl, Last-Event-ID
                        │
  ┌──────────── JmapPushHub (one per browser, Web Locks leader) ─────────────┐
  │  • holds per type the hash it last confirmed; builds Last-Event-ID from it│
  │  • drops StateChanges that equal what the apps already have               │
  │  • coalesces bursts                                                       │
  │  • publishes to every tab over a crossTabTopic                            │
  └──────▲─────────────────────────────────────────▲──────────────────────────┘
         │ transport (truth, always on)            │ transport (messenger)
  EventSourceTransport                      MeshCheckNowTransport
  SSE over fetch, bearer auth,              presence data channel: "check now",
  Last-Event-ID, honours retry              no payload → hub reconnects at once
```

### Transport contract

```ts
interface PushTransport {
  /** Starts the transport; returns a stop function. */
  start(sink: PushSink): () => void;
}

interface PushSink {
  /** A StateChange from the server, with the event id that followed it. */
  deliver(change: StateChange, eventId: string): void;
  /** "Something may have changed, ask the server now." Any transport may call it. */
  wake(reason: string): void;
}
```

Only the server transport calls `deliver`. Every other transport can only `wake`. So all data still comes from the server, under the user's own rights, with one cursor. A transport that fails or lies costs at most one extra request.

### The id is built from confirmed hashes

The event id is a list of independent per-type hashes, so the hub does not resend the id it last received. It keeps, per type, the hash from the id that came with the last StateChange whose sync every subscribed app reported as successful (Notes and the Docs home can both subscribe to one type). A type no open app subscribes to counts as confirmed: the app syncs when it opens. On every reconnect the hub sends `Last-Event-ID` rebuilt from those confirmed hashes. A sync that failed (network, a `401` in the middle of a refresh) left its type at the old hash, so the server sends that type again on the next reconnect. There is no pending list, no retry timer and no state to hand over. A tab learns what another tab subscribes to only from that tab's own messages, so while a live tab (one that holds its tab lock) has no entry in this tab's copy, for example right after a new leader asks the others to report, the hub sends no `Last-Event-ID` and the server sends every type. A hub that stopped and starts again drops the other tabs' entries first, because it missed their updates.

Hashes cannot be ordered, so the hub never runs two syncs of the same type at once: one sync in flight per type, and a newer push only replaces the hash that waits for the next sync. Otherwise an older sync that fails after a newer one succeeded would roll back a confirmed hash.

The browser cannot compute these hashes itself (for `FileNode` the hash covers the user's root markers, not the global sequence), so it only takes them from ids the server sent. The leader publishes each confirmed hash on the `crossTabTopic`, so every tab holds the same map. A new leader starts from its copy; with none, it sends no id, the server answers with every type, and the apps compare and sync only what really differs.

### Event source over fetch

The native `EventSource` cannot send the `Authorization` header, and the API authenticates with a bearer token (`lib/api/wgw/http.ts`). The client reads the stream with `fetch` and a small SSE parser (`data:`, `id:`, `event:`, `retry:`), through the existing authenticated fetch, so token refresh works as for every other call.

We write that reader ourselves, about a hundred lines with tests, instead of depending on `@microsoft/fetch-event-source`. That package solves the header problem, but its last release (2.0.1) is from April 2021. It does not reconnect when the server ends the stream normally (you have to throw from `onclose`), and by default it closes while the tab is hidden.

Behaviour:

- `types=*`, `closeafter=state`, `ping=0`. The URL comes from the session's `eventSourceUrl`; a guest share session has no push.
- After the response ends, reconnect after the server's `retry` (visible), or after 30 s when every tab is hidden.
- A wake reconnects early, but never sooner than 2 s after the previous request.
- Offline: stop. Online again: reconnect at once. The reconnect flush already syncs the apps.
- `401`: refresh the token through the shared auth path, then reconnect.
- `429` or repeated failures: wait `Retry-After` (or back off from `retry`, doubling up to 60 s), and report push as down so the app polls return to their normal interval. A single failure does not count as down; the second in a row does.
- `501`, or a response that is not an event stream: push is off on this server. Report it down and ask again after 5 minutes.

The code is in `packages/apps/src/lib/jmap-client/push/` (reader, transport, hub, leader) and `packages/apps/src/lib/api/wgw/jmap-push.ts` (wiring to the authenticated fetch).

### Leader and fan-out

Only one tab per browser holds the stream. The leader is elected with a Web Locks lock (`navigator.locks`), not the presence leader, so a blocked or failing mesh cannot stop the safety net. The leader publishes each StateChange on a `crossTabTopic` (`lib/offline/core/cross-tab-topic.ts`), so every tab hears it, the leader included. When the leader closes, the next tab takes the lock and reconnects with the id it rebuilds from the confirmed hashes it already holds. A hidden leader gives the lock back while another subscribed tab is visible (Chrome runs the timers of a tab hidden for 5 minutes only once a minute, so it would reconnect late). It checks when it becomes hidden, when it gets the lock, when a tab joins, and when a tab says it became visible. A joining tab says in its first message whether it is visible, because the browser grants its visible lock only later. A visible tab never hands over, so the lock settles there.

Only tabs with a subscriber take part, so an app that does not use push costs nothing. Each such tab also holds a Web Lock while it is open, and another while it is visible. The leader reads them with `navigator.locks.query()`: a tab that crashed without saying goodbye drops out of the confirmed-hash map, and "every tab hidden" needs no heartbeat. Without Web Locks the hub stays off and the apps keep their polls.

### Apps

```ts
useJmapStateChange(["Note", "Notebook"], (states) => notesAdapter.syncIfStale(states));
```

Each JMAP adapter (`lib/jmap-client/adapter/*`) already has `sync()` and knows its current state. A new `syncIfStale` calls `sync()` only when a pushed state differs from the adapter's own, and reports success or failure to the hub: the listener resolves `false` when the sync failed. A type the adapter has no state for yet is not confirmed. Pushes that arrive while a listener runs collapse into one next call with the newest states. That `sync()` uses `/changes`, which returns only what changed, so there is no per-collection hint and no new sync path.

**Collab rooms lead.** While a note or doc has an active collab room in this browser, the Yjs layer already has its content. The app then does not refetch that item's body on a push; it only applies metadata (title, tags, notebook, archive state). Without this rule every collaborator would fetch the doc they are typing in every few seconds.

| App | Types | Calls |
|-----|-------|-------|
| Notes | `Note`, `Notebook` | `JmapNotesAdapter.sync()` |
| Contacts | `ContactCard`, `AddressBook` | `JmapContactsAdapter.sync()` |
| Calendar | `CalendarEvent`, `Calendar` | `JmapEventsAdapter.sync()` |
| Meet chat | `ChatMessage`, `ChatChannel` | `JmapChatAdapter.sync()`. Chat is already live over the mesh, and that preview stays ([notifications.md](notifications.md#rule-9-when-a-transport-may-carry-content)). Push replaces the 4 s fallback poll, the heaviest poll in the suite, and covers peers without a mesh. |
| Notification inbox | `Notification` | inbox fetch, local-ack, toast ([notifications.md](notifications.md#active-news-on-the-client)) |
| Drive, Docs home | `FileNode` | `FileNode/changes` for the visible folder (`use-drive-file-node-inbound.ts`) |
| Tasks | `Task`, `TaskList` | `refreshList` |

The existing polls stay as the fallback. They slow down while push is connected and return to their normal interval when it is not. `useJmapPushConnected()` gives a poll that state; both hooks live in `lib/api/wgw/use-jmap-state-change.ts`. Work that one tab should do per push, such as fetching the inbox once and sharing it, checks `hub.leading`: the tab that holds the stream is visible whenever any subscribed tab is.

## Mesh "check now"

After a write lands, the writing tab sends `{ "v": 1, "kind": "check-now" }` over the presence data channel, the same mesh that already carries chat acceleration and `notify-hint` (`meet-core/src/meet-mesh-sot.ts`). A peer's `MeshCheckNowTransport` calls `sink.wake()`, and the hub reconnects at once instead of waiting for `retry`. That brings in-suite changes to about 1 s on shared hosting. `channel-changed` and `notify-hint` become `check-now`. Targets, throttles and the preview rule are in [notifications.md](notifications.md#the-mesh-as-messenger).

- It goes only to a targeted set: for active news, the usernames the notifying mutation returns (from #1607); otherwise the peers who share at least one collection with the writer. When the writer does not know, it sends nothing; the event source catches the change within `retry`.
- Writes that come from an active collab room (Yjs saves) send no check-now. The Yjs channel has delivered the content already, and the event source catches the metadata within its retry.
- The writer throttles (about one per 2 s); the receiver allows at most one early reconnect per 2 s.
- Without a mesh (WebRTC blocked, room full at 32 peers), nothing changes: the event source still delivers within `retry`.
- It needs no server change and no app change.

## Security

- Same authentication as every other API call, with its own rate-limit bucket.
- States are computed per user from the collections and roots that user can access. A state never names a collection the user cannot see.
- Drive pushes only when one of the user's own roots changed, so the global sequence does not reveal other people's activity.
- A grantee's state changes the moment a share is created, so they notice the share at that moment. That is intended (it is when they get access), not a leak.
- A pushed state is a reason to sync, never data. The app re-reads through `/changes` with its own session.
- `check-now` has no payload. It does reveal that a peer just wrote, so it goes only to peers who share a collection with the writer. A forged one costs one request.
- A rate-limited or failing push falls back to the app polls at their normal interval; it never ends in "no news".

## Known gaps

1. **Collection metadata:** not a gap in the state. Every rename or recolour, from the app or from a DAV `PROPPATCH`, goes through Sabre's `updateCalendar` / `updateAddressBook`, which move the shared synctoken, so `/changes` and push see it for everyone with access (#1671). What stays per user: when a calendar, notebook or task list is shared with a person, each sharee has their own name and colour for the collection, so the owner's rename wakes the sharee's app but does not change the name the sharee sees. Group collections have one name for every member.
2. **Docs threads:** they use the Drive ACL; a later slice.
3. **Tasks:** there is no JMAP type yet. Push uses the REST list state.

## Open questions

1. **Retry values:** visible vs hidden, and the default for shared hosting. Measure with k6.
2. **Slower per-app polls once push works:** measure first.
3. **Body edits:** confirm with k6 that the collab-room rule keeps `/changes` traffic from typing low.
