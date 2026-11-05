# Notifications and live updates

One architecture for everything that is news to a user: data that changed under an open app, and events that deserve their attention. Status: **proposal, not built**. Epic: #1659 (Goals WeGotWorkspace/Product#149 and WeGotWorkspace/Product#150). Spec, plan and chunks: [.agents/specs/1659-live-updates/](../../.agents/specs/1659-live-updates/).

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

|                 | Silent                                                                                                                                      | Active                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| What creates it | any write; the data's own change counter moves                                                                                              | a write or a schedule that `NotifyListener` allow-lists (`meet.started`, `docs.thread_activity`, `calendar.invite`, …) |
| Stored as       | nothing new: the per-user JMAP `state` is derived                                                                                           | a `notifications` row per recipient                                                                                    |
| Who receives it | everyone whose state changes, i.e. who can read the collection                                                                              | recipients chosen by the producer, never the actor                                                                     |
| Push type       | `Note`, `Notebook`, `CalendarEvent`, `Calendar`, `ContactCard`, `AddressBook`, `FileNode`, `ChatMessage`, `ChatChannel`, `Task`, `TaskList` | `Notification` (new)                                                                                                   |
| Client action   | the app runs its `/changes` sync if it shows that type                                                                                      | fetch the inbox, local-ack, popover, toast or OS notification                                                          |

Silent news needs no curation: every change to data the user can read moves their state. Active news is curated: only allow-listed `domain.action` pairs create inbox rows, as today.

## Delivery by situation

| Situation                     | Silent                             | Active                                                                        |
| ----------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| A tab is visible              | the app syncs                      | popover + in-app toast in one tab                                             |
| App running, every tab hidden | the app syncs (slower cadence)     | popover; nothing is acked, so the OS notification arrives as Web Push (#1605) |
| No tab and no PWA running     | nothing; the app syncs when opened | Web Push (VAPID): urgent news at once, other news after the local-ack grace   |

Latency on shared hosting:

| Path                                                           | Typical                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Writer is a WGW tab sharing a collection with you, mesh linked | about 1 s (mesh "check now" → event source → fetch)           |
| Writer is outside the mesh or outside the suite                | within the event-source retry, about 3 s                      |
| Web Push, urgent news (meeting started), app closed            | a few seconds: sent right after the write's response          |
| Web Push, other active news, app closed                        | 20–80 s (20 s local-ack grace, then up to one 60 s cron tick) |

### Urgent active news

"A peer starts a meeting" is worthless after 80 seconds. So `meet.started`, and for now only that action, skips the local-ack grace: the server sends its Web Push right after the response of the write that caused it (a Laravel `afterResponse` callback; with PHP-FPM the browser already has its answer), not on the next cron tick. Calendar alerts have their own alarm path and are known in advance; a chat mention that arrives 40 s later is not broken. Every extra urgent action would be another after-response send on the same workers.

An after-response send still holds a PHP-FPM worker until it finishes, and each subscription is a TLS round trip to a push service. So the send is bounded:

- all subscriptions are sent in parallel (curl multi), with a hard total timeout of 1.5 s;
- at most 20 subscriptions per event go out after the response; any beyond that, and any that did not finish within the timeout, stay due for the next cron sweep;
- delivery status is kept per subscription, not per notification: a `vapid` row in `notification_deliveries` with the subscription's endpoint hash, so the sweep only sends to devices that are still open and never repeats one that already got it;
- the cutoff of 20 is measured: about 0.2 s of worker time per meeting start, while 40 subscriptions double it and stretch the tail ([realtime-capacity.md](../realtime-capacity.md#urgent-web-push-after-response-send)).

Built in #1670 (spec: [.agents/specs/1670-urgent-meet-push/](../../.agents/specs/1670-urgent-meet-push/)): `UrgentPushService`, deferred from `NotifyListener`; the urgent local row is due after a 5 s hold, counted from when the row is written, so the sweep does not race the send unless the join takes longer than that to answer.

That push reaches every device of the recipient, also one where the app is open. The service worker then checks `clients.matchAll()`: when a visible WGW window exists in that browser, it posts the item to every visible window (`wgw-notification-pushed`), whose inbox shows it at once, and shows no OS notification where the browser allows that (table below). The push payload carries the inbox id, so the window merges the item by id; the `Notification` state or the next poll confirms it afterwards, and the item never chimes twice. This works even while push to that tab is down or rate-limited. Where the browser does not allow it, you see the item in the window and an OS notification for the same meeting; we accept that duplicate. The local-ack keeps its job for other news: stopping a push to another device that an open client already showed. The in-app toast (#1669) hooks in where the posted item enters the inbox.

#### May the service worker skip the OS notification? (spike, #1670)

| Browser                                      | Skips with a visible window | Why (source)                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium (Chrome, Edge), desktop and Android | **Yes**                     | `PushMessagingNotificationManager::DidCountVisibleNotifications`: "Sites with a currently visible tab don't need to show notifications." It checks the active tab of every window (desktop, installed app windows included) or tab model (Android) for a visible page of the origin. Without one, a silent push spends site-engagement budget and Chrome eventually shows "This site has been updated in the background". |
| Firefox desktop                              | **Yes**                     | `PushService._updateQuota` / `PushRecord.getLastVisit`: while a tab of the origin is open, every push resets the quota (16), so a silent push costs nothing.                                                                                                                                                                                                                                                              |
| Firefox for Android                          | **No**                      | GeckoView reads the last visit from history instead of the open tabs, so each silent push uses up quota until the next visit; at zero Firefox drops the subscription.                                                                                                                                                                                                                                                     |
| Safari and every iOS browser (WebKit)        | **No**                      | No silent push. Since iOS 18.4 / macOS 15.5 the declarative payload (`web_push: 8030`) is shown as the fallback when the worker shows nothing; before that, a few pushes without a notification revoke the subscription.                                                                                                                                                                                                  |

The service worker reads the engine from its user agent (`push-delivery.ts`): `Chrome/`, `Chromium/` or `Edg/` → Chromium; `Firefox/` without `Android` → Firefox desktop; anything else shows the notification. A visible window means `WindowClient.visibilityState === "visible"`, which is the same page visibility Chromium checks. Chromium does not handle the declarative payload; if it ever does, re-check this table. Still to confirm on real devices: an installed Android app window (WebAPK) counts as a visible tab (push matrix #1608).

## Active news on the client

While push is down, the inbox polls every 15 s (`NOTIFICATIONS_INBOX_POLL_MS`) and re-fetches on a mesh `check-now`. Steps 2, 3 and 7 below are built (#1668, `notifications-core/src/use-notifications-inbox-push.ts`), and so are the toast, steps 4–6 (#1669, `notifications-core/src/use-notification-toasts.ts`), and `check-now` (#1662). In this design:

1. The server exposes a per-user `Notification` state in the event source. The `notifications` table has no change marker today, and `supersede` rewrites rows in place. So it gets one: an `updated_at` (or a per-principal sequence) that create, supersede, clear and read all touch.
2. When the `Notification` state changes, one tab fetches the inbox once and fans the new rows out to every tab. That tab is the one that holds the push stream (`hub.leading`), which is visible whenever any tab is, so a paused background tab never delays the bell. The others skip the fetch and show the rows it shares on a `crossTabTopic` (`inbox-fan-out.ts`), tagged with the pushed state they answer. A tab confirms the push only once it has those rows: the stream tab after its fetch, another tab after the share for that state arrives. A failed fetch is shared as failed and not confirmed, and a tab that hears nothing within 10 s (`INBOX_SHARE_WAIT_MS`: the stream tab closed mid-fetch) does not confirm either, so the server sends the change again. A poll or visibility refresh that starts meanwhile does not cancel the push fetch. `Notification` states are the server's per-user inbox counter, so a share for an older state that arrives late is ignored (the stream tab claims its state before it fetches, so this also holds while its GET runs), and rows for a newer state also answer a wait for an older one.
3. **Local-ack** follows #1605: only a visible window, or one in a Meet call, acks a delivery, so VAPID skips it. Receiving through push instead of a poll makes that ack earlier, which only makes a duplicate Web Push less likely. A refresh sends every row not yet acked in one `POST /notifications/local-ack` (#1826), and the browser remembers the acked ids in `localStorage` (`wgw.offline.notifications.localAcked`, newest 500, wiped on sign-out; `local-acked-store.ts`), so a reload or another tab sends nothing for them, also a tab that takes over the event stream from the tab that acked them (#1834). Tabs flush one at a time under the Web Lock `wgw-notifications/local-ack` and re-read that list once they hold it, so two visible tabs never send the same rows. A failed batch is remembered for nothing and retried on the next refresh.
4. **One tab shows the toast:** the most recently focused visible tab, elected through the hub. Every tab reports its focus, visibility and current route to the hub. If no tab is visible, no tab shows anything itself and nothing is acked: the Web Push service worker is the only OS notification path (#1605).
   Each tab's `tab` message on the hub's `crossTabTopic` carries the time of its last window focus and its route (path plus query, reported by the shell on every navigation). `hub.frontTab()` takes the tabs that hold a visible lock (so a crashed tab never wins) and picks the one focused last; ties go to the lowest tab id, so every tab elects the same one. A tab that sees a new unread row asks the hub: if it is in front it toasts the row, if another tab is in front it leaves the row to that tab, and if no tab is visible the row gets no toast, then or later. A row created while the front tab was hidden gets no toast either when that tab only fetches it after the user comes back (a throttled or frozen background tab): Web Push alerted the user, so the row waits in the popover. The rule compares the row's `createdAt` (whole seconds) with the moment the tab became visible again, with 2 s of slack; a browser clock further ahead of the server can hide toasts for news that arrives in that gap.
   A tab answers another tab's first `tab` message with its own, so a tab that joins (for example one opened in the background) knows every tab's focus at once and elects the same front tab. The decision is kept per browser in `localStorage` (`wgw.offline.notifications.toastDecided`, newest 500), so a row toasts at most once, also when the front tab moves or a slower tab fetches the row later. Rows already unread when the app loads never toast.
5. The toast uses the existing toast primitive (`ui/sonner.tsx`, `AppToastCallout`) in a notification style. It names the app and the actor, acts on click through the item's `navigate`, and marks the row read on that click. It is `role="status"`, never takes focus, and follows reduced motion.
6. **No toast for what you are looking at.** If the item's `navigate` points at the screen the toast tab already shows (a comment on the Doc you have open), the item goes to the popover without a toast. The open app already shows the change. "Points at" means the same path (DM peers compared case-insensitively) and every query parameter of `navigate` present on the route with the same value; `/calendar` matches the Calendar start screen, not a week view under `/calendar/…`.
7. The 15 s poll stays as the fallback and slows to 60 s (`NOTIFICATIONS_INBOX_PUSH_POLL_MS`) while push is connected. When push is down it returns to 15 s, below the 20 s local-ack grace.

### Measured (#1668)

Time from a notifying write (a DM to the user, sent over REST) to the row in the bell, push only, on a local dev install (Vite dev server, PHP built-in server, Chromium):

| Setup                                                       | DM sent → row shown                                     |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Two tabs, by hand, nine DMs                                 | 0.2–2.7 s, median 1.3 s                                 |
| `e2e/notifications-inbox-push.spec.ts`, two tabs, five runs | 2.4 s; 2.9 s after the stream tab reloads               |
| Same spec, one run by the review loop on a CI runner        | 2.6–3.0 s, the other tab within 30 ms of the stream tab |

Before #1668 the bell waited for its 15 s poll. Now the spread follows the stream's 3 s `retry`: the worst case is about one retry plus one request. The spec's numbers barely vary because it sends at the same point in that cycle. Each DM caused one inbox `GET` and one `local-ack` for the whole browser.

**With `check-now` (#1662):** `e2e/mesh-check-now.spec.ts`, two users in two browsers, the writer writing from their open tab at a random point in the retry cycle, four runs of three rounds, same local setup:

| Write → shown to the other user | Mesh up | Mesh blocked (push alone) |
|---------------------------------|---------|---------------------------|
| DM → row in the bell | 0.12–0.23 s, median 0.14 s | 0.84–3.5 s, median 1.9 s |
| Task on a shared list → in their open Tasks tab | 0.22–0.42 s, median 0.32 s | 0.21–2.9 s, median 1.4 s |

With the mesh up, a change no longer waits for the next `retry`.

**Local-ack grace:** stays at 20 s. While push is connected a visible tab acks within about 3 s, so 5–10 s would do. But while push is down (rate-limited, `501`, offline) the ack waits for the 15 s poll, and the server cannot tell which case a browser is in, so a shorter grace would send phone pushes for news already on screen. Revisit once push uptime is measured: either poll faster while push is down, or give a shorter grace only to a user whose browser made an event-source request in the last few seconds.

## The mesh as messenger

The principal presence mesh already carries chat acceleration (`meet-core/src/meet-mesh-sot.ts`):

- `channel-message`, `-patch`, `-destroy`, `channel-reaction`: the message itself, sent only to the channel's readers, checked on arrival (sender is the author, sender and receiver are both readers), and confirmed by the server poll.
- `check-now`: no content; the receiver's push hub asks the server now (#1662). It replaced `channel-changed` and `notify-hint`.

Who receives a chat preview, and the chat `check-now` that follows it (`meet-core/src/meet-mesh-fanout-targets.ts`):

| Channel | Receivers |
|---|---|
| DM | the other person |
| Team channel, shared channel, meeting chat | the channel's `members`: the server roster (owner side plus sharees, Teams expanded), minus the writer |
| A cached row without `members` | its explicit user grants in `shareWith`; nobody for a Team channel |
| A channel the writer has not cached | nobody |

Never the presence room as a whole: it holds every signed-in coworker who is online, and most of them cannot read the channel. Guests do not join the presence room. A receiver drops a preview for a channel it does not hold, or whose cached roster lacks the sender or itself, before anything is stored. Unit tests pin this in `meet-mesh-fanout-targets.test.ts`; the live spec `meet-mesh-channel-roster` checks a coworker outside the Team gets no frame.

How `check-now` works:

- After any successful write, the writer sends `{ "v": 1, "kind": "check-now" }` to a targeted set of users, never to the whole workspace:
  - **active news:** a mutation that notifies other users returns the notified usernames, and the writer sends to exactly them (taken over from #1607);
  - **silent news:** the users it knows share the collection (`shareWith`, group members, channel roster).

  When the writer does not know, it sends nothing; the event source catches the change within its retry. The message has no content, but it does reveal that this user just wrote, so it never goes to peers without a shared collection.

- Writes that come from an active collab room (Yjs saves of a note or doc being edited together) send no check-now: the Yjs channel has delivered the content, and the event source catches the metadata within its retry.
- The receiving hub reconnects its event source at once. It allows at most one early reconnect per 2 s, so even a storm of writes costs each browser at most 30 extra requests a minute.
- Built (#1662): the writer's audience comes from `X-Wgw-Notified` (active news: the server names the users this request notified) and from the cached `shareWith` user grants of the collection (silent news, `lib/offline/core/collection-check-now.ts`). Group grants, group collections and Drive have no member list on the client, so they nudge nobody. Meet chat sends its check-now to the same channel `members` as its previews (`meet-mesh-sot.ts`).
- The chat preview kinds stay as they are, under rule 9.

### Rule 9: when a transport may carry content

A preview is allowed only when all of these hold:

- the item is small and self-contained (a chat message, not a file listing);
- the sender sends it only to the users the server lists as readers of the collection, never to the presence room as a whole;
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

| Today                                                                         | With this design                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Notes, Contacts, Calendar poll every 10 s                                     | push; the poll stays as a slow fallback                                                      |
| Drive and Tasks never refresh while open                                      | push                                                                                         |
| Chat polls every 4 s next to its mesh acceleration                            | push plus mesh; the preview stays; the poll slows down                                       |
| Inbox polls every 15 s, plus `notify-hint`                                    | push (`Notification` type) plus mesh `check-now`                                             |
| Active news while the app is open: popover only (OS notification when hidden) | popover + in-app toast in the visible tab (#1669); Web Push when every tab is hidden (#1605) |
| Web Push when every client is closed: 20–80 s                                 | urgent news within seconds; other news unchanged                                             |

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
2. **Service worker per browser:** answered by the spike in #1670, see "May the service worker skip the OS notification?" above.

## Review history

The design went through three external reviews on 2026-10-26. The rejected alternatives and the decision per review point are in [.agents/specs/1659-live-updates/plan.md](../../.agents/specs/1659-live-updates/plan.md#considered).
