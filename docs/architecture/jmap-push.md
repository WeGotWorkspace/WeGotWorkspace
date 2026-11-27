# JMAP Push

Design for telling open apps "data you can see changed, sync now", without WebSockets. It implements JMAP Push over an event source ([RFC 8620 §7](https://www.rfc-editor.org/rfc/rfc8620#section-7)) on top of the change counters the server already keeps. It is the transport half of [notifications.md](notifications.md), which sets the rules for silent and active news. Epic: #1659. Status: **server and client hub built** (#1660, #1661; the notification inbox uses it since #1668; the mesh `check-now` since #1662; the other apps still to do); revised after three external reviews (see [plan.md](../../.agents/specs/1659-live-updates/plan.md#considered)).

---

## Problem

Live editing of a Doc or Note body is instant (Yjs over the RTC mesh), and so is Meet chat for peers on the principal mesh (`meet-core/src/meet-mesh-sot.ts`). Everything else reaches other people only through each app's own poll, or not at all:

| App               | How it sees other people's changes today                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Notes             | JMAP `/changes` every 10 s (`ONLINE_CHANGES_POLL_MS`, `notes-core/src/use-notes-api.ts`)                           |
| Contacts          | same, 10 s (`contacts-core/src/use-contacts-api.ts`)                                                               |
| Calendar          | background refresh every 10 s (`calendar-core/src/use-calendar-surface.ts`)                                        |
| Meet chat         | live over the mesh; JMAP `/changes` every 4 s as the authoritative fallback (`meet-core/src/use-meet-chat-api.ts`) |
| Drive / Docs home | `FileNode/changes` on app start and after a reconnect flush only. No timer.                                        |
| Tasks             | reconnect flush and manual `refreshList` only. No online poll.                                                     |

All of these polls skip while `document.hidden`. A file a colleague drops in a shared folder does not show up until you reload Drive.

The suite runs on shared hosting with a small PHP-FPM pool ([realtime-capacity.md](../realtime-capacity.md)), so the server cannot hold a connection per browser open.

## The source of truth already exists

Every write already advances a counter that the per-user JMAP `state` strings are built from:

| Data                                                                                             | Counter                                                                                                                                    | Covers                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Notes, calendar events, tasks, Meet chat, Docs threads (all VEVENT / VTODO / VJOURNAL in CalDAV) | Sabre `calendars.synctoken` + `calendarchanges`                                                                                            | every write path: DAV clients, REST, JMAP, MCP. `NoteMoveHelper` bumps it directly.                         |
| Contacts                                                                                         | Sabre `addressbooks.synctoken` + `addressbookchanges`                                                                                      | same; `AddressBookShareInvites` also bumps on share                                                         |
| Drive                                                                                            | `jmap_file_nodes.change_seq` (one global sequence, `FileNodeIndexService`) plus the hash of the user's member grants (`FileNodeSyncState`) | writes through the file-node index; a member grant added, revoked, hidden (Epic #1915) or changed in access |

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

The id is a plain list of independent per-type hashes, never one hash over the whole. `<h>` is a 128-bit hash (32 hex characters) of the type's state for the user. A collision would be a silent, permanent miss, so it is not truncated further. For `FileNode` the hash covers the composite of the user's root markers and member grants, while the StateChange value is the FileNode state `<seq>.<scopeHash>` (below). Because the parts are independent, the client can rebuild an id from the hashes it has confirmed ([below](#the-id-is-built-from-confirmed-hashes)). An unknown or malformed id counts as "everything differs": the server sends the current states of all requested types, and the client compares them with its own and only syncs types that really changed.

### Types

| Type                         | State source                                                                                  | Note                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Note`, `Notebook`           | notebook instances + synctokens                                                               | existing JMAP types                                                                                            |
| `CalendarEvent`, `Calendar`  | calendar instances + synctokens                                                               | existing                                                                                                       |
| `ContactCard`, `AddressBook` | address book listings + synctokens                                                            | existing                                                                                                       |
| `ChatMessage`, `ChatChannel` | channel instances + synctokens                                                                | existing                                                                                                       |
| `FileNode`                   | a change marker per visible root, plus the user's member grants (below)                       | existing; grants since #1926                                                                                   |
| `Task`, `TaskList`           | task list instances + synctokens (`TaskListRepository`)                                       | no JMAP type today. Use the type names from the JMAP Tasks draft, so a later JMAP Tasks surface can keep them. |
| `Notification`               | a change marker per principal on `notifications` (below)                                      | WGW type for active news; the client fetches the inbox                                                         |
| `DocThread`                  | Docs thread pools behind the user's Drive roots (below)                                       | WGW type (#2286); the open document calls `files/threads/changes`                                              |
| `RtcRoom`                    | roster signature and newest message per signaling room where the user has a live peer (below) | WGW type (#2294); the user's rooms poll their mailbox once                                                     |
| `Project`                    | a change marker per Team on `project_markers`, over the user's Teams                          | WGW type for Projects (#817); the client refetches `GET /projects`. Joining or leaving a Team changes it too.  |
| `MeetCall`                   | the set of the user's channel and DM rooms that have a joinable peer (below)                  | WGW type (#2295); Meet chat reads room status once                                                             |

Every state read is O(collections or roots the user can see), never O(changes on the server).

### Docs threads: pools behind the Drive roots

Docs comment and suggestion threads live in one hidden VJOURNAL pool per file owner (a user or a Team, `docs-threads`, kind `DocsThreadPool`). Their access comes from the Drive ACL (`DriveShareAuthorizer`), not calendar shares, so the `DocThread` state follows the user's Drive roots (`FileNodeAccountSupport::rootsAndGrantPairs`, `DocThreadPushState`, #2286):

- **Whole owner tree** (`users/<me>`, `groups/<team>`): the pool's sync token. The user can read every thread in it.
- **Share root deeper in someone else's tree:** a digest of the uid and etag of the threads and replies on documents at or under that root (`docs_thread_index` joined with `calendarobjects`). A comment on another document of the same owner does not move it, so a grantee learns nothing about documents they cannot read.

A user without a pool behind any root gets `0:`. Two indexed reads, plus one per share root.

### Meet calls: the channel call doorbell

The `MeetCall` state (`MeetCallPushState`, #2295) covers the rooms of the chat channels and DMs the user can access: each channel's collection id and, for a meeting channel, its stored guest room code. A room counts as active under the same rule as `room-status`: it has a live peer (`seen_at` within the Meet peer timeout) that is an account, or a named guest who is not knocking. The value is `<active rooms>.<hash>` over the sorted active room ids, or `0` when none is active. A call starting or ending moves it; a second peer joining a running call, a heartbeat and a knock do not, and neither does a call in a channel the user does not belong to. Meet chat then reads `room-status` for the selected and joined channels once. Two reads: the room codes of the user's channels, and the live peers in those rooms (indexed on `room`). A call whose last peer times out rings when the push stream next recomputes the state, not at the second it expires.

### Signaling rooms: the room doorbell

The `RtcRoom` state (`RtcRoomPushState`, #2294) covers, per channel table (Docs collab, presence, Meet), every room where the user has a live peer: `owner_user` is the user and `seen_at` is within the channel's peer timeout. Per room it hashes the roster signature the room poll returns (`HttpSignalingMailbox::rosterSignature`: peer ids, names, owner, access, caps, network class; never `seen_at`, which every heartbeat moves) over the live peers, plus the newest message id addressed to one of the user's peers. The value is `<rooms>.<hash>`, or `0` without a room.

- A peer joining or leaving, or a message to one of the user's peers, changes it; a heartbeat does not.
- A room where the user has no live peer never reaches the state, so it reflects no room the user has not joined (presence of other people in other rooms stays invisible).
- Reads per channel: the user's live peers (index `owner_user, seen_at`), the live peers of those rooms (`room`), and the newest message per own peer (`room, to_peer, id`).
- Signaling payloads (offers, answers, ICE) stay on the room route; push only rings.

On the client each room's poll loop (`MeshPollLoop`) listens to the doorbell (`room-doorbell.ts`): a ring polls at once; while push is connected and no rostered peer is being dialled, the room does not poll; while push is down it keeps its own cadence ([realtime-capacity.md](../realtime-capacity.md)).

**The push read is the room heartbeat (#2287).** Each push read sends the browser's own live peers as `X-WGW-Rtc-Peers: collab:<peerId>,principal:<peerId>,meet:<peerId>` (at most 32; `push-heartbeat-peers.ts`). Every tab publishes its peers under its own `localStorage` key, rewritten every 20 s, so the tab that holds the stream names the peers of all tabs; an entry older than 45 s (a crashed tab) is removed. The server (`RtcPushHeartbeat`) validates each id against its channel's peer-id pattern and reads the named peers with `owner_user = u:<caller>` whose `seen_at` is more than 20 s old; fresher peers cost no write. A collab or presence room re-checks access on every poll, so the push read runs the same check before it refreshes such a peer: the share grant on the canonical room stored at join (`collab_peers.room_path`, since `room` is only its hash), or Team membership for a presence room. Without access the caller's peers leave the room; a downgrade is written to the roster. Either way the room's `RtcRoom` state changes, so both sides poll once and the removed tab gets its 403. A revoked share or a removed Team member therefore reaches a quiet room within about 30 s, as it did with the 30 s heartbeat poll. Meet's poll does not re-check membership, so neither does the push read. A caller cannot refresh another user's peer, and peers nobody names (a closed laptop, another device) still expire after the peer timeout. A room whose peer is left out of the capped header, or on a channel without this heartbeat, keeps a 30 s heartbeat poll. A Meet mailbox drops acknowledged messages, so its newest message id can go down after a poll and ring once more; that costs one extra poll per message.

### Drive: a change marker per root

`FileNode/get` returns `<seq>.<scopeHash>` as `state`: the global `currentSeq()` and a 128-bit hash of the user's sorted account roots (own tree plus member Teams) and the sorted `(grant id, access)` pairs of their live, visible member grants (`FileNodeSyncState`, #1926, #2063). Pushing the sequence as-is would wake every browser on any file change and show everyone when others are active. Filtering change rows per poll instead (as `changesSince` does) would scale with server-wide write volume. So the server keeps a marker per root:

- **Write:** every Drive write bumps the marker of each root its storage key falls under: the account root (`users/x` or `groups/y`) and every share root that is an ancestor of the key. The share roots are found by looking up the key's ancestor paths, O(depth). One upsert per root touched, not one per person with access, so a group folder with 200 members costs the same as a private one.
- **Move and delete** bump the root set of the old path and of the new path, so a grantee sees an item leave their share.
- **Batch operations** (folder upload, batch move, zip) compute the root set once per operation and bump each root once, not once per file.
- **Missing rows:** a root without a marker row counts as 0, so two equal situations always give the same composite.
- **Read:** the user's roots come from `FileNodeAccountSupport::rootsFor`, which already includes group roots and shares to a single person. The user's push state for `FileNode` is a hash over the sorted list of `root → marker` pairs of those roots, followed by the sorted `(grant id, access)` pairs of the user's live, visible member grants: identity and value, so adding or revoking any root changes it, even an empty one at 0. The event id carries that hash. A new share adds a root, so the composite changes. Hiding one of two grants on the same root (Epic #1915) or changing a grant's access in place moves neither a marker nor `change_seq`; the grant pairs make the hash change anyway, so an open app wakes without a file write.
- **Push value:** the StateChange carries the FileNode state `<seq>.<scopeHash>`, because that is what `FileNode/changes` expects as `sinceState`. It is only sent when the user's composite changed. `FileNode/changes` answers `cannotCalculateChanges` when `scopeHash` differs from the user's current one (a Team join or leave, or a grant change), or for a grant-only or legacy all-digit state, so the client resyncs once and gets a delta again after that.

### Inbox: a change marker per principal

The `notifications` table has no change column, and `supersede` rewrites rows in place. It gets a per-principal marker (an `updated_at` or a per-principal sequence) that create, supersede, clear and read all move. The `Notification` state is that marker.

### Rate limit

`wgw-api` is 600/min per account, shared by every tab and device (`WgwApiRateLimiters`). The JWT carries no session id (`sub`, `role`, `iat`, `uid`), so the push route gets its own bucket keyed by user plus the browser id the client already sends for presence (`RtcBrowserId`):

- about 60/min per browser: 20/min of regular reconnects (12/min while the mesh is linked) plus up to 30/min of check-now reconnects, with margin;
- a per-account ceiling (for example 300/min), so a client that rotates browser ids cannot escape the limit.

A `429` carries `Retry-After`. The client waits that long and treats push as down meanwhile, so the app polls return to their normal interval. A full bucket never ends in silence. Going offline and back during that wait does not end it early.

### Cost and measurement

Each request boots Laravel, reads the user's CalDAV collections once for every CalDAV-backed type (notes, calendars, chat, tasks), and reads the address books, the Drive markers and the inbox marker. No writes, except Team provisioning the first time a Team is seen. Measured locally with PHP-FPM and 5 children ([realtime-capacity.md](../realtime-capacity.md#3-s-or-5-s-by-mesh-state-1943), #1943):

| Browsers open | 3 s: requests per minute | busy children (average) | 5 s (mesh linked): requests per minute | busy children (average) |
| ------------- | ------------------------ | ----------------------- | -------------------------------------- | ----------------------- |
| 5             | 96                       | 0.11                    | 57                                     | 0.12                    |
| 16            | 302                      | 0.51                    | 180                                    | 0.32                    |
| 32            | 605                      | 0.73                    | 363                                    | 0.32                    |

The median push request took 41–48 ms. These are laptop numbers with a near-empty data set; a shared host with MySQL is still to measure. `tools/load/rtc-shared-hosting.k6.js` has the push scenario, with the client interval, several accounts and an FPM busy-children sampler. `WGW_JMAP_PUSH_RETRY_MS` is the lever on slow hosts. Once push works, the per-app polls (10 s, chat 4 s, inbox 15 s) can slow down. Their requests are heavier than a push check, so the total can end up lower than today. That is a separate decision after measuring.

#### Making "nothing changed" cheap (#2243)

A push check that finds nothing new is the common case, so its cost is what matters. Before #2243 each CalDAV-backed source read the collections on its own, each time with a Team lookup and a Sabre provisioning check per Team, and the Drive member grants were read three times. On top of that, every JMAP request built all ~50 method handlers only to list the capability URNs.

Now:

- `CalendarCollectionAccess::accessibleInstancesByKind()` reads the personal and Team collections of every requested kind in one query; the four sources take their sync tokens from that one result (Server-Timing entry `caldav`).
- Team provisioning for calendars and address books checks every Team in one query (`ensureForGroupPrincipals`, `ensureForPrincipals`).
- `FileNodeAccountSupport::rootsAndGrantPairs()` reads the member grants once for both the roots and the grant part of the Files state.
- `JmapMethodDispatcher` keeps class names and builds a handler on its first call; `name()` and `capability()` are static. This also speeds up `GET /jmap/session` and every `POST /jmap`.

Same seeded data before and after (one user in four Teams with six own and six shared calendars, five shared folders), all pushed states byte-identical:

| Source                                   | MySQL queries before |               after | MySQL p50 before (ms) |          after (ms) | SQLite Server-Timing before (ms) | after (ms) |
| ---------------------------------------- | -------------------: | ------------------: | --------------------: | ------------------: | -------------------------------: | ---------: |
| shared CalDAV read                       |                    – | (in the rows below) |                     – | (in the rows below) |                                – |       3.63 |
| notes                                    |                   23 |                   5 |                  16.7 |                 2.8 |                             2.65 |       0.08 |
| calendars                                |                   24 |                   6 |                  17.7 |                 3.7 |                             2.25 |       0.16 |
| contacts                                 |                   19 |                   5 |                  14.0 |                 2.9 |                             0.77 |       0.62 |
| chat                                     |                   24 |                   7 |                  17.4 |                 3.8 |                             1.57 |       0.03 |
| files                                    |                    8 |                   4 |                   6.4 |                 2.2 |                             2.15 |       1.11 |
| tasks                                    |                   23 |                   5 |                  16.6 |                 2.9 |                             1.83 |       0.07 |
| inbox                                    |                    1 |                   1 |                   0.7 |                 0.5 |                             0.17 |       0.15 |
| all sources together                     |                  122 |                  19 |                    89 |                11.0 |                                  |            |
| whole request, booted kernel (with auth) |                  129 |                  26 |                  95.5 |                17.5 |                                  |            |

MySQL numbers are MySQL 8 in Docker on a laptop, in-process with a booted kernel; queries are counted with `Questions`, so Sabre's raw PDO reads count too. One source is requested at a time, then all together; per-source "after" numbers include the shared CalDAV read. Server-Timing is SQLite with all sources requested.

Whole request over HTTP (`php -S` with opcache, SQLite, a laptop, 40 requests): push check p50 61.5 ms → 15.9 ms (p95 70.1 → 16.7), `GET /jmap/session` 50.0 → 9.2 ms, `/health` unchanged at about 6 ms. Most of the old cost was the handler construction (about 35 ms per request), not the state reads.

A "something changed" marker per user or per install, so a check could skip the state reads, was not built: every write path (apps, DAV clients, Team and share changes) would have to bump it, and the reads are now cheap enough. Hosted numbers (`WGW_JMAP_PUSH_SERVER_TIMING=1` on a shared host) are still to come.

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

The browser cannot compute these hashes itself (for `FileNode` the hash covers the user's root markers and member grants, not the global sequence), so it only takes them from ids the server sent. The leader publishes each confirmed hash on the `crossTabTopic`, so every tab holds the same map. A new leader starts from its copy; with none, it sends no id, the server answers with every type, and the apps compare and sync only what really differs.

### Event source over fetch

The native `EventSource` cannot send the `Authorization` header, and the API authenticates with a bearer token (`lib/api/wgw/http.ts`). The client reads the stream with `fetch` and a small SSE parser (`data:`, `id:`, `event:`, `retry:`), through the existing authenticated fetch, so token refresh works as for every other call.

We write that reader ourselves, about a hundred lines with tests, instead of depending on `@microsoft/fetch-event-source`. That package solves the header problem, but its last release (2.0.1) is from April 2021. It does not reconnect when the server ends the stream normally (you have to throw from `onclose`), and by default it closes while the tab is hidden.

Behaviour:

- `types=*`, `closeafter=state`, `ping=0`. The URL comes from the session's `eventSourceUrl`; a guest share session has no push.
- After the response ends, reconnect after the server's `retry` while a tab is visible or in a live Meet call (6 s instead of 3 s while nobody touched any tab for 2 minutes, #2294), or after 30 s when every tab is hidden and none is in a call. A hidden tab in a call local-acks (#1605), so it has to see a new inbox row within the 20 s local-ack grace; at 30 s it often missed it and push alerted during the call (#2129). While this browser's presence mesh has held a link for 30 s, the visible interval is `retry` × 5/3: 5 s instead of 3 s ([below](#interval-by-mesh-state)).
- A wake reconnects at once, also right after a regular reconnect. Two early reconnects start at least 2 s apart (`wakeGapMs`).
- Offline: stop. Online again: reconnect at once. The reconnect flush already syncs the apps.
- `401`: refresh the token through the shared auth path, then reconnect.
- `429` or repeated failures: wait `Retry-After` (or back off from `retry`, doubling up to 60 s), and report push as down so the app polls return to their normal interval. A single failure does not count as down; the second in a row does.
- `501`, or a response that is not an event stream: push is off on this server. Report it down and ask again after 5 minutes.

The code is in `packages/apps/src/lib/jmap-client/push/` (reader, transport, hub, leader) and `packages/apps/src/lib/api/wgw/jmap-push.ts` (wiring to the authenticated fetch).

### Leader and fan-out

Only one tab per browser holds the stream. The leader is elected with a Web Locks lock (`navigator.locks`), not the presence leader, so a blocked or failing mesh cannot stop the safety net. The leader publishes each StateChange on a `crossTabTopic` (`lib/offline/core/cross-tab-topic.ts`), so every tab hears it, the leader included. When the leader closes, the next tab takes the lock and reconnects with the id it rebuilds from the confirmed hashes it already holds. A hidden leader gives the lock back while another subscribed tab is visible or in a live Meet call (Chrome runs the timers of a tab hidden for 5 minutes only once a minute, so it would reconnect late). It checks when it becomes hidden or leaves a call, when it gets the lock, when a tab joins, and when a tab says it became visible or joined a call. A joining tab says in its first message whether it is visible or in a call, because the browser grants its locks only later. A visible tab, or one in a call, never hands over, so the lock settles there. Being in a call does not make a tab the front tab. Each tab's message also carries when its window last had focus and the route it shows, and repeats whenever focus, visibility or route changes; `hub.frontTab()` uses them to elect the tab that shows in-app toasts ([notifications.md](notifications.md#active-news-on-the-client), #1669).

Only tabs with a subscriber take part, so an app that does not use push costs nothing. Each such tab also holds a Web Lock while it is open, another while it is visible, and a third while it is in a live Meet call. The leader reads them with `navigator.locks.query()`: a tab that crashed without saying goodbye drops out of the confirmed-hash map, and "every tab hidden" (no visible lock and no call lock) needs no heartbeat. Without Web Locks the hub stays off and the apps keep their polls.

### Apps

```ts
useJmapStateChange(["Note", "Notebook"], (states) =>
  notesAdapter.syncIfStale(states),
);
```

Each JMAP adapter (`lib/jmap-client/adapter/*`) already has `sync()` and knows its current state. A new `syncIfStale` calls `sync()` only when a pushed state differs from the adapter's own, and reports success or failure to the hub: the listener resolves `false` when the sync failed. A type the adapter has no state for yet is not confirmed. Pushes that arrive while a listener runs collapse into one next call with the newest states. That `sync()` uses `/changes`, which returns only what changed, so there is no per-collection hint and no new sync path.

**Collab rooms lead.** While a note or doc has an active collab room in this browser, the Yjs layer already has its content. The app then does not refetch that item's body on a push; it only applies metadata (title, tags, notebook, archive state). Without this rule every collaborator would fetch the doc they are typing in every few seconds.

| App                | Types                        | Calls                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes              | `Note`, `Notebook`           | `JmapNotesAdapter.sync()` (built, `use-notes-live-inbound.ts`); the open note comes without `body` (`note-body-rooms.ts`)                                                                                                                                                                                      |
| Contacts           | `ContactCard`, `AddressBook` | `JmapContactsAdapter.sync()`                                                                                                                                                                                                                                                                                   |
| Calendar           | `CalendarEvent`, `Calendar`  | `JmapEventsAdapter.syncIfStale()` (built, `use-calendar-live-inbound.ts`); the 10 s event poll runs only while push is not healthy                                                                                                                                                                         |
| Meet chat          | `ChatMessage`, `ChatChannel` | `JmapChatAdapter.sync()`. Chat is already live over the mesh, and that preview stays ([notifications.md](notifications.md#rule-9-when-a-transport-may-carry-content)). Push replaces the 4 s fallback poll, the heaviest poll in the suite, and covers peers without a mesh.                                   |
| Notification inbox | `Notification`               | inbox fetch in one tab, fanned out to the others, local-ack (built, `use-notifications-inbox-push.ts`); in-app toast in the front tab (built, `use-notification-toasts.ts`; [notifications.md](notifications.md#active-news-on-the-client)). No inbox poll while push is connected (#2287)                     |
| Drive, Docs home   | `FileNode`                   | `FileNode/changes` through `use-drive-file-node-inbound.ts`, then the open folder and the Docs home lists load again in place (built, `drive-file-node-push.ts`). One tab per browser makes the call; the others repaint from a cross-tab notice. No poll: without push, folders load on navigation as before. |
| Tasks              | `Task`, `TaskList`           | `syncTasksInbound` when the pushed state differs from the stored task-list changes state, which is the same value (built, `use-tasks-live-inbound.ts`)                                                                                                                                                         |
| Docs threads       | `DocThread`                  | the open document calls `files/threads/changes` once per push (built; the shared pull in `src/lib/live/use-push-pulled-list.ts`, Docs declares it in `use-docs-threads-source.ts`, #2298); the 4 s poll runs only while push is down (#2286)                                                                   |
| Signaling rooms    | `RtcRoom`                    | each Docs, presence and Meet room of the tab polls its mailbox once (built, `mesh-poll-loop.ts`, `room-doorbell.ts`); the push read keeps the peers alive, so no heartbeat poll; without push the rooms keep their own cadence                                                                                 |
| Meet call badge    | `MeetCall`                   | Meet chat reads `room-status` of the selected and joined channels once per push and on selection change (built, `use-meet-channel-call-activity.ts`, #2295); the 5 s poll runs only while push is down                                                                                                         |

**One syncing tab per app.** Notes, Contacts, Calendar and Meet chat share one inbound sync per browser, app and account (#2252, `JmapInboundAdapter.shareAcrossTabs`, `inbound-sync-share.ts`). The tab that holds the Web Lock `wgw-inbound-sync/<app>/<account>` runs the push rounds and the fallback poll; the other tabs skip both and re-read the shared cache when the syncing tab says a round is done. A tab that is behind on a push confirms it when that message arrives; if none comes within 5 s (`SHARED_ROUND_WAIT_MS`: the syncing tab loaded after the change, so it had nothing to pull), it pulls for itself. That lock follows the stream's rule above: every such tab holds a second lock while it is visible, and a hidden holder gives the sync lock back and queues again while another tab with that app is visible (it checks when it becomes hidden, when it gets the lock, and when a tab says it is visible). A hidden tab does not run its poll, so with push down the updates still arrive in the visible tab. An explicit `sync()` (the user acted in that tab) always runs.

Tasks takes a seat in the same election (#2261, `useInboundSyncSeat`, lock `wgw-inbound-sync/tasks/<account>`). It has no adapter: its changes state lives in the offline cache, which every tab reads. The syncing tab runs the poll and pulls on a push, then tells the other tabs to repaint (`notifyTasksBootstrapUpdated`). A tab that does not sync confirms a push once the cache holds the pushed state; if that takes longer than 5 s (`TASKS_SHARED_PULL_WAIT_MS`) it pulls for itself. A tab that takes over pulls once right away.

Drive already runs one `FileNode/changes` per browser for each push, under a lock, and has no poll. What each tab did for itself was the listing of its open folder after a change. Tabs that show the same folder now share that fetch (#2261, `drive-folder-fetch-share.ts`): the change notice carries one time stamp for all tabs, the first tab to take the lock `wgw.drive.folder-fetch.<account>.<path>` fetches and sends its listing over a BroadcastChannel, and the others take a listing stamped with their change or a newer one. A tab fetches for itself when none arrives within 5 s. Tabs on different folders each fetch their own. Share-link guests do not take part.

The sync cursor stays in memory. After a round, once its cache writes have finished, the syncing tab sends its cursor with the "round done" message and the other tabs store it. A tab's cursor is therefore never ahead of the cache. The tab that takes over runs one round at once: from the last shared cursor, or, when the previous tab closed before its writes landed, from an older cursor of its own, which reads a few changes twice and skips none. A round whose cache write failed puts the cursor back to where it started, shares nothing and counts as failed, so the next poll or push reads the change again; after three such rounds in a row (`MAX_REWOUND_ROUNDS`) the cursor moves on, so a record that can never be written is not pulled without end. After an expired change log the syncing tab re-lists once into the shared cache; that serves every tab, because no tab's adapter loads a window of its own (Calendar always loads the bootstrap window). Without Web Locks or BroadcastChannel every tab syncs for itself, as before. Tasks and Drive have their own sync and are not part of this.

The existing polls stay as the fallback, and run only while push is not healthy (#2296). Push is healthy while the stream answered in the last two rounds (`useJmapPushHealthy()`, next to `useJmapPushConnected()`, both in `lib/api/wgw/use-jmap-state-change.ts`); the second failed round in a row, `429`, `501` and offline end it. Every inbound sync (Notes, Contacts, Tasks, Calendar, Meet chat) arms its backup poll through one helper, `usePushBackupPoll` in `lib/live/use-push-backup-poll.ts`; it stops the poll while push is healthy and starts it again, at the normal interval (10 s, Meet chat 4 s), when push stops. A push response also counts as a reachability success and a push request that never reached the server feeds the probe backoff (`reportReachability`, `setPushHealthy` in `lib/offline/core/browser-online.ts`); the separate reachability probe runs only while push is not healthy. Calendar's invitations poll (#2287) is a separate poll: it runs every 60 s instead of 10 s while push is connected, and a tab that turns visible re-reads the cache that live inbound sync keeps current instead of running a full bootstrap.

### Doorbell pattern

How a live update is built in this suite (#2298). The server rings a bell; the app pulls.

- **Live means a push type whose state is cheap per caller.** The state is one indexed query, with no `seen_at`-style heartbeat fields that change on their own and ring for every caller.
- **The app pulls when the state changes.** A type changing is the doorbell; the data comes from the type's `/changes` feed, not from the push message. `usePushPulledList` (`src/lib/live/use-push-pulled-list.ts`) is the client half for a list: one fetch, then a pull per ring.
- **A backup poll runs only while push is unhealthy.** Use `usePushBackupPoll` (or `useJmapPushHealthy()`); with push healthy the poll is off (see "The existing polls stay as the fallback").
- **A short fast poll runs only while a WebRTC peer is connecting.** Signaling rooms use their own cadence in that window and fall back to the room doorbell afterwards.
- **Cost budget:** a push request with every type stays at 25 ms or less on the reference stack (measured 14 ms for 13 types).

Every client poll needs a reason: `tools/network-polls-ratchet.test.mjs` (run by `ci:quality:apps`) lists each `*_POLL_MS` / `*_POLL_INTERVAL_MS` constant and `setInterval`, and fails when a new one has no entry.

## Mesh "check now"

After a write lands, the writing tab sends `{ "v": 1, "kind": "check-now" }` over the presence data channel, the same mesh that carries chat acceleration (`meet-core/src/meet-mesh-sot.ts`). A peer's `MeshCheckNowTransport` calls `sink.wake()`, and the hub reconnects at once instead of waiting for `retry`. That brings in-suite changes to well under a second (0.2–0.4 s locally, [notifications.md](notifications.md#measured-1668)). It replaced `channel-changed` and `notify-hint`. Targets, throttles and the preview rule are in [notifications.md](notifications.md#the-mesh-as-messenger).

- It goes only to a targeted set: for active news, the usernames the notifying mutation returns (from #1607); otherwise the peers who share at least one collection with the writer. When the writer does not know, it sends nothing; the event source catches the change within `retry`.
- Writes that come from an active collab room (Yjs saves) send no check-now. The Yjs channel has delivered the content already, and the event source catches the metadata within its retry.
- The writer throttles (about one per 2 s); the receiver allows at most one early reconnect per 2 s.
- Without a mesh (WebRTC blocked, room full at 32 peers), nothing changes: the event source still delivers within `retry`.
- The server names who a request notified in the `X-Wgw-Notified` response header (`NotifiedRecipients`); the client sends `check-now` to exactly them (`lib/api/wgw/notified-header.ts`). The app write paths add the cached `shareWith` users of the collection.

### Interval by mesh state

With a working mesh, colleagues' writes arrive through `check-now`, so the regular reconnect is only the safety net for what the mesh does not carry: external DAV edits, peers without a mesh, your own other devices (they send no `check-now`), and what `check-now` leaves to push on purpose (a sharee who writes, group grants, silent Drive changes). So the visible interval depends on the mesh (#1943):

| This browser's presence mesh                                                       | Visible reconnect interval            |
| ---------------------------------------------------------------------------------- | ------------------------------------- |
| An open data channel to another user's peer, held for 30 s                         | `retry` × 5/3: 5 s at the default 3 s |
| None (WebRTC blocked, room full, no peers linked yet), or a link younger than 30 s | `retry`: 3 s                          |

- The server stays the source of the base: the client scales whatever `retry` it sends, so `WGW_JMAP_PUSH_RETRY_MS` still slows every browser on a slow host.
- "Linked" comes from the presence store (`PresenceStore.meshLinked`). The tab that dials the mesh relays its open peer ids with the roster, so a follower tab that holds the push stream knows it too. The port is `meshLinked` / `subscribeMeshLinked` in `lib/jmap-client/push/mesh-check-now.ts`; the choice is `MeshRetryInterval` (`mesh-retry-interval.ts`).
- No thrash: a lost link counts at once, and shortens a running 5 s wait to 3 s from its start. A new link counts only after it has held for 30 s, and never lengthens a running wait. A mesh that flaps stays at 3 s.
- Unchanged: 30 s while every tab is hidden, `Retry-After` on `429`, the failure back-off (doubling from `retry`, not from 5 s), and the 2 s wake gap.
- Local ack: a visible tab still acks within one interval plus a fetch, about 5.5 s at most, well inside the 20 s grace ([notifications.md](notifications.md#active-news-on-the-client)).

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
4. **Drive shares from another user:** `FileNode/changes` lists the change, but the offline cache cannot place a node under a share rooted in someone else's tree (`resolveNodePath`). The open folder still refreshes, because it loads the folder from the server; the cache for that share does not follow. The Docs home does not list files inside such a share at all, push or not.

## Open questions

1. **Retry values:** the default stays 3 s; the visible interval is 5 s while the mesh is linked (#1943, [measured](../realtime-capacity.md#jmap-push-event-source)); hidden stays 30 s. Still open: the default for a real shared host, measured there.
2. **Slower per-app polls once push works:** measure first.
3. **Body edits:** confirm with k6 that the collab-room rule keeps `/changes` traffic from typing low.
