# Notifications and live updates

One architecture for everything that is news to a user: data that changed under an open app, and events that deserve their attention. Status: **proposal, not built**. Tracker: #1533 (to be re-scoped under a new Epic).

It builds on the Web Push decisions of Epic #1600: a window acks a notification only while it is visible or in a Meet call (#1605), and hidden windows show nothing themselves, so Web Push is the only OS notification path.

Detail lives in two companion docs:

- [jmap-push.md](jmap-push.md): per-user state, the JMAP event source, the push hub and its transports.
- [suite-notify.md](suite-notify.md): the server pipeline for active news (inbox rows, local-ack, Web Push).

---

## Rules

1. **One collection point.** All news is collected on the server, at the moment of the write, whatever the entry point: the app, MCP, or an external DAV client.
2. **Silent news** keeps open screens current without telling anyone: a new file in the open Drive folder, a tag removed from the open note, a new message in the open chat thread.
3. **Active news** asks for attention: a peer starts a meeting while I am in another app, a peer comments on my Doc.
4. **Every active item is in the notification popover** (the inbox).
5. **App open:** active news also shows as an in-app toast, in one tab only.
6. **App closed:** active news goes out as Web Push; urgent news, such as a meeting starting, goes out at once.
7. **The server is the truth; the event source always runs.** It is the safety net for every peer the mesh cannot reach and for changes from outside the suite.
8. **WebRTC is the fastest messenger, not the source.** After a write, the writer sends a content-free "check now" over the mesh, only to peers who share a collection with them. Whatever arrives first, mesh or event source, sets the client moving. Content and rights always come from the server.
9. **One exception, by rule: a preview.** A transport may carry content only for a small, ACL-checked item that the server confirms afterwards. Today that is only a Meet chat message.
10. **The server decides what is active and who sees what.** One allow-list, server-side rights.
11. **One receiver per browser.** A hub in the leader tab receives, de-duplicates and fans out, so one item never makes two toasts.

Later: per-event preferences (inbox on or off, push on or off), already designed in [suite-notify.md](suite-notify.md#future-per-event-delivery-preferences).

## Two kinds of news, one source

```text
             write: app (REST / JMAP), MCP, external DAV client
                                 │
                        SERVER (source of truth)
          ┌──────────────────────┴───────────────────────┐
  silent: change counters                        active: inbox row
  Sabre synctoken / calendarchanges /            EventDispatch → NotifyListener
  addressbookchanges, Drive change_seq           (allow-list, recipients, dedupe)
          │                                              │
  per-user JMAP state per type                    per-user "Notification" state
          └──────────────────────┬───────────────────────┘
                     JMAP event source (always)          Web Push (no client running)
                                 │
        mesh "check now" ───────►│◄─────── (earlier, when a mesh exists)
                                 │
                       PUSH HUB (one per browser)
        ┌───────────────┬────────┴─────────┬─────────────────────┐
  silent: the app   active: popover    active: toast in       chat preview
  syncs via         (inbox list)       the visible tab;       (rule 9)
  /changes                             Web Push when
                                       every tab is hidden
```

| | Silent | Active |
|-|--------|--------|
| What creates it | any write; the data's own change counter moves | a write or a schedule that `NotifyListener` allow-lists (`meet.started`, `docs.thread_activity`, `calendar.invite`, …) |
| Stored as | nothing new: the per-user JMAP `state` is derived | a `notifications` row per recipient |
| Who receives it | everyone whose state changes, i.e. who can read the collection | recipients chosen by the producer, never the actor |
| Push type | `Note`, `Notebook`, `CalendarEvent`, `Calendar`, `ContactCard`, `AddressBook`, `FileNode`, `ChatMessage`, `ChatChannel`, `Task`, `TaskList` | `Notification` (new) |
| Client action | the app runs its `/changes` sync if it shows that type | fetch the inbox, local-ack, popover, toast or OS notification |

Silent news needs no curation: every change to data the user can read moves their state. Active news is curated: only allow-listed `domain.action` pairs create inbox rows, as today.

## Delivery by situation

| Situation | Silent | Active |
|-----------|--------|--------|
| A tab is visible | the app syncs | popover + in-app toast in one tab |
| App running, every tab hidden | the app syncs (slower cadence) | popover; nothing is acked, so the OS notification arrives as Web Push (#1605) |
| No tab and no PWA running | nothing; the app syncs when opened | Web Push (VAPID): urgent news at once, other news after the local-ack grace |

Latency on shared hosting:

| Path | Typical |
|------|---------|
| Writer is a WGW tab sharing a collection with you, mesh linked | about 1 s (mesh "check now" → event source → fetch) |
| Writer is outside the mesh or outside the suite | within the event-source retry, about 3 s |
| Web Push, urgent news (meeting started), app closed | a few seconds: sent right after the write's response |
| Web Push, other active news, app closed | 20–80 s (20 s local-ack grace, then up to one 60 s cron tick) |

### Urgent active news

"A peer starts a meeting" is worthless after 80 seconds. So `meet.started`, and for now only that action, skips the local-ack grace: the server sends its Web Push right after the response of the write that caused it (a Laravel `afterResponse` callback; with PHP-FPM the browser already has its answer), not on the next cron tick. Calendar alerts have their own alarm path and are known in advance; a chat mention that arrives 40 s later is not broken. Every extra urgent action would be another after-response send on the same workers.

An after-response send still holds a PHP-FPM worker until it finishes, and each subscription is a TLS round trip to a push service. So the send is bounded:

- all subscriptions are sent in parallel (curl multi), with a hard total timeout of 1.5 s;
- at most 20 subscriptions per event go out after the response; any beyond that, and any that did not finish within the timeout, stay due for the next cron sweep;
- delivery status is kept per subscription, not per notification (today `notification_deliveries` has one row per notification and channel), so the sweep only sends to devices that are still open and never repeats one that already got it;
- the cutoff of 20 is a starting value; the load test measures it before it is fixed.

That push reaches every device of the recipient, also one where the app is open. The service worker then checks `clients.matchAll()`: when a visible WGW client exists in that browser, it posts the item to that client, whose hub shows the toast, and shows no OS notification where the browser allows that. The `Notification` state confirms the item afterwards; the hub de-duplicates by inbox id, so the toast appears once. This works even while push to that tab is down or rate-limited. Safari requires a visible notification for every push, so there you may see a toast and an OS notification for the same meeting. We accept that duplicate; a spike confirms per browser before the task is built. The local-ack keeps its job for other news: stopping a push to another device that an open client already showed.

## Active news on the client

Today the inbox polls every 15 s (`NOTIFICATIONS_INBOX_POLL_MS`) and re-fetches on a mesh `notify-hint`. In this design:

1. The server exposes a per-user `Notification` state in the event source. The `notifications` table has no change marker today, and `supersede` rewrites rows in place. So it gets one: an `updated_at` (or a per-principal sequence) that create, supersede, clear and read all touch.
2. When the `Notification` state changes, the hub fetches the inbox once and fans the new rows out to every tab. `notify-hint` becomes a generic mesh "check now".
3. **Local-ack** follows #1605: only a visible window, or one in a Meet call, acks a delivery, so VAPID skips it. Receiving through push instead of a poll makes that ack earlier, which only makes a duplicate Web Push less likely.
4. **One tab shows the toast:** the most recently focused visible tab, elected through the hub. Every tab reports its focus, visibility and current route to the hub. If no tab is visible, no tab shows anything itself and nothing is acked: the Web Push service worker is the only OS notification path (#1605).
5. The toast uses the existing toast primitive (`ui/sonner.tsx`, `AppToastCallout`) in a notification style. It names the app and the actor, acts on click through the item's `navigate`, and marks the row read on that click. It is `role="status"`, never takes focus, and follows reduced motion.
6. **No toast for what you are looking at.** If the item's `navigate` points at the screen the toast tab already shows (a comment on the Doc you have open), the item goes to the popover without a toast. The open app already shows the change.
7. The 15 s poll stays as the fallback and slows down while push is connected.

## The mesh as messenger

The principal presence mesh already carries chat acceleration (`meet-core/src/meet-mesh-sot.ts`):

- `channel-message`, `-patch`, `-destroy`, `channel-reaction`: the message itself, checked on arrival (sender is the author, sender is an ACL member), and confirmed by the server poll.
- `channel-changed`: no content; the receiver re-fetches the channel from REST.
- `notify-hint`: no content; the receiver re-fetches the inbox.

This design generalises the content-free part:

- After any successful write, the writer sends `{ "v": 1, "kind": "check-now" }` to a targeted set of users, never to the whole workspace:
  - **active news:** a mutation that notifies other users returns the notified usernames, and the writer sends to exactly them (taken over from #1607);
  - **silent news:** the users it knows share the collection (`shareWith`, group members, channel roster).

  When the writer does not know, it sends nothing; the event source catches the change within its retry. The message has no content, but it does reveal that this user just wrote, so it never goes to peers without a shared collection.
- Writes that come from an active collab room (Yjs saves of a note or doc being edited together) send no check-now: the Yjs channel has delivered the content, and the event source catches the metadata within its retry.
- The receiving hub reconnects its event source at once. It allows at most one early reconnect per 2 s, so even a storm of writes costs each browser at most 30 extra requests a minute.
- `channel-changed` and `notify-hint` become `check-now`. The chat preview kinds stay as they are, under rule 9.

### Rule 9: when a transport may carry content

A preview is allowed only when all of these hold:

- the item is small and self-contained (a chat message, not a file listing);
- the receiver checks the sender against the collection's ACL it already holds;
- the server confirms it: the next sync replaces the preview with the stored item, or removes it;
- losing the preview loses nothing, because the event source delivers the same change.

Today only Meet chat qualifies. A new preview needs a line in this section first.

## Why the event source always runs

- The writer cannot know whom the mesh missed: a peer behind a strict firewall, a second device, the 33rd browser in a full presence room.
- Changes from outside the suite never touch the mesh.
- Rights: a payload over the mesh is filtered by the sender's view of the ACL, which can be stale. A state from the server is computed with the receiver's rights at that moment.
- Active news must become an inbox row anyway, for the popover and for the local-ack that stops a duplicate Web Push.

## What changes compared with today

| Today | With this design |
|-------|------------------|
| Notes, Contacts, Calendar poll every 10 s | push; the poll stays as a slow fallback |
| Drive and Tasks never refresh while open | push |
| Chat polls every 4 s next to its mesh acceleration | push plus mesh; the preview stays; the poll slows down |
| Inbox polls every 15 s, plus `notify-hint` | push (`Notification` type) plus mesh `check-now` |
| Active news while the app is open: popover only (OS notification when hidden) | popover + in-app toast in the visible tab; Web Push when every tab is hidden (#1605) |
| Web Push when every client is closed: 20–80 s | urgent news within seconds; other news unchanged |

## Phasing

Phase 1 delivers everything above:

1. **Server:** JMAP event source with per-user states, including `Notification`, the Drive root markers and the inbox marker ([jmap-push.md](jmap-push.md)).
2. **Client core:** the push hub, the event-source reader, cross-tab fan-out, Web Locks leader, the mesh `check-now` transport, and toast-tab election.
3. **Apps:** Notes, Drive and Docs home, Calendar, Tasks, Contacts, Meet chat.
4. **Active news:** inbox on push, in-app toasts, urgent Web Push.
5. **Gaps:** collection rename and colour change move the state.

Later: per-event preferences, Docs threads, holding connections open on a separate worker pool.

## Open questions

1. **Event-source retry and fallback poll values:** measure with k6 first.
2. **Service worker per browser:** which browsers let it skip the OS notification when a visible client exists (spike before the urgent-push task).

## Changes after review 1

External review 1 (2026-10-26) kept the core and changed these details. The sections above already reflect them.

| Review point | Decision |
|--------------|----------|
| Hold mode is long-poll, against the rule that signaling never long-polls on a small PHP-FPM pool | Dropped. Short-burst only; no setting holds a connection open. |
| The Drive check scans change rows on every poll | Replaced by a change marker per visible root, bumped at write. The read is O(number of roots). |
| The rate-limit bucket is too small for the check-now storm case | Own bucket per browser (user + browser id), about 60/min, plus a per-account ceiling. |
| The hub records a state before the app's sync succeeded | The hub records a type's state only after the app's sync succeeds; a failed sync is retried. |
| Web Push at 20–80 s is too slow for "meeting started" | Urgent actions skip the grace and are sent right after the response. The service worker skips the OS notification when a visible client exists, where the browser allows it. |
| Yjs saves make every collaborator refetch a doc they already have | While a note or doc has an active collab room, the app does not refetch its content; metadata still syncs. |
| Leader election | Web Locks, independent of the presence mesh, so a mesh failure cannot stop the safety net. |
| The toast rule needs each tab's route | Tabs report their route to the hub. |
| "Drive single-person shares" gap | Not a gap: share roots are already visible roots (`FileNodeAccountSupport::rootsFor`). Removed. |
| Event-id hash length | 128-bit hashes. A collision would be a silent, permanent miss. |
| A wide check-now reveals that a user just wrote | Sent only to peers who share at least one collection with the writer; when unknown, not sent. |
| An exhausted bucket ends in silence | While push is rate-limited or down, the app polls return to their normal interval. |
| Short-burst is a poll with SSE framing | Stated as such. We keep the RFC event source: it is already advertised, serves external JMAP clients, and leaves room to hold connections later on a separate pool. |

## Changes after review 2

External review 2 (2026-10-26) confirmed the first round and found four more points; one of them makes the client smaller.

| Review point | Decision |
|--------------|----------|
| Pending states, retries and their handover need storage outside the leader tab | Gone. The hub keeps, per type, the hash it last confirmed, and builds `Last-Event-ID` from those. On reconnect the server re-sends every type that was not confirmed. A new leader sends the confirmed id and is up to date. |
| An after-response Web Push holds a PHP-FPM worker for every TLS handshake | Parallel send with a hard 1.5 s total timeout and at most 20 subscriptions per event after the response; anything slower or beyond falls back to the cron sweep. |
| Drive markers miss moves and deletes out of a share, and batches cost N × depth upserts | Move and delete bump the root set of the old and the new path. Batch operations compute the root set once and bump once. A root without a marker row counts as 0. |
| Collab saves send check-now, so every collaborator reconnects while someone types | Writes that come from an active collab room send no check-now. |
| Out of scope still names Drive single-person shares | Removed. |
| Urgent push depends on the toast task | The service worker only suppresses the OS notification; the hub shows the toast. The urgent-push task depends on the inbox and toast tasks. |
| Which news is urgent | Only `meet.started`. |
| The load test only measures reads | The k6 scenario also covers marker upserts and after-response sends. |
| A grantee notices a share when its state changes | Intended, and written down under Security in [jmap-push.md](jmap-push.md#security). |

## Changes after review 3

External review 3 (2026-10-26) found three errors and three small points; the reviewer considers the design ready to build after these.

| Review point | Decision |
|--------------|----------|
| A composite that only aggregates marker values cannot see a share of an empty folder (a 0 added or removed changes nothing) | The `FileNode` hash covers the sorted list of `root → marker` pairs: root identity and value. Adding or revoking any root changes it, also at 0. |
| Delivery status per notification makes the cron sweep resend to devices that already got the after-response push | Delivery status per subscription; the sweep only picks up the open ones. The 20-subscription cutoff is measured, not assumed. |
| A service worker that only suppresses leaves a gap when push is down | The service worker posts the item to the visible client; that client's hub shows the toast, and the `Notification` state confirms it afterwards (de-duplicated by inbox id). This replaces the review-2 decision. |
| Two syncs of one type at once can roll back a confirmed hash | One sync in flight per type; a newer push replaces the waiting hash. |
| "An app subscribed to that type" | Every subscribed app must confirm before the hash counts as confirmed. |
| The client task carries three blocking parts | Built first: Web Locks leader, confirmed-hash id, SSE reader. |
