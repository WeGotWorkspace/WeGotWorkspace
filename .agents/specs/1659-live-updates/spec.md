Source: #1659 (body-hash: a50a6998)
Goal: WeGotWorkspace/Product#149, WeGotWorkspace/Product#150

# Notifications and live updates

Technical translation of Epic [#1659](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1659). Child Tasks: #1660–#1669, #1671 and #1533. Related under Epic #1600: #1670 (urgent Web Push), which builds on #1601 and #1605. The canonical design is [docs/architecture/notifications.md](../../../docs/architecture/notifications.md) (rules, silent vs active news, delivery) and [docs/architecture/jmap-push.md](../../../docs/architecture/jmap-push.md) (state, event source, hub, transports). This spec does not repeat them; it fixes what an implementer must hold on to.

## Goal

Open apps learn within seconds that data or news they show has changed, without WebSockets and without holding a PHP-FPM worker. The server exposes the per-user JMAP state it already computes through the advertised `eventSourceUrl` (RFC 8620 §7.3) in short-burst form. One push hub per browser reads it and fans it out to every tab. Apps call their existing `/changes` sync. The WebRTC presence mesh only wakes the hub sooner (`check-now`), and Meet chat keeps its content preview as the one exception. Active news shows as a toast in the visible tab and stays in the inbox; Web Push stays the path when no window is visible (#1605).

## Non-goals

- WebSockets, long-poll, or any held connection, on any host.
- A new change log or per-recipient fan-out for CalDAV/CardDAV data: the Sabre synctokens are the log.
- Per-event delivery preferences (designed in `suite-notify.md`).
- Docs threads as a push type; Mail.
- Push while no tab is open (Web Push already covers active news).
- Changing presence poll cadences or the Meet chat mesh preview.

## Affected packages

- packages/api: event-source controller replacing `JmapStubController::eventSource`, per-type state resolution, Drive root markers, inbox marker, rate limiter, OpenAPI.
- packages/apps: push hub, SSE reader, Web Locks leader, `useJmapStateChange`, `syncIfStale` on the JMAP adapters, mesh `check-now`, toasts, app adoption.
- docs: `docs/architecture/notifications.md`, `docs/architecture/jmap-push.md`, `docs/realtime-capacity.md` (k6 result).

## Technical constraints

- **Short-burst only.** Every response ends at once: a `state` event plus `id`, or `retry:`. Five FPM workers on shared hosting are shared with signaling.
- **Per-user, O(collections) reads.** A state read never scans change rows. Drive uses a marker per visible root; the inbox a per-principal marker.
- **Event id = independent per-type 128-bit hashes** (`v1;Type=<h>;…`). The client rebuilds `Last-Event-ID` from hashes every subscribed app confirmed; it never computes a hash itself.
- **`FileNode` hash** covers the sorted `root → marker` pairs of `FileNodeAccountSupport::rootsFor` (identity and value); the StateChange value stays the global sequence `FileNode/changes` expects.
- **Rights.** States come from the collections and roots the user can access. `check-now` carries no ids and goes only to targeted users (notified usernames for active news, collection sharers otherwise).
- **Bearer auth.** The SSE reader runs over the authenticated fetch; native `EventSource` cannot send the header.
- **Rate limit.** Own bucket per user + browser id (~60/min) with a per-account ceiling; `429` makes the apps fall back to their normal polls.
- **Fallback.** Existing per-app polls stay; they only slow down while push is connected.

## Edge cases

- A share of an empty, never-written folder must change the grantee's `FileNode` state (missing marker row = 0, but the root is in the hash).
- Move or delete out of a share bumps the old and the new root set; batch operations bump each root once.
- A sync that fails, or two pushes for one type in flight: one sync per type, the old hash stays until every subscribed app confirms.
- Leader tab closes: the next tab takes the Web Locks lock and reconnects with its copy of the confirmed hashes, or with no id.
- Yjs saves from an active collab room send no `check-now`, and the app does not refetch that item's body.
- Push down or rate-limited: no toast is lost (service worker posts urgent items to the visible client; the inbox poll still runs).
- Safari requires a notification for every push: a duplicate toast plus OS notification for `meet.started` is accepted.
