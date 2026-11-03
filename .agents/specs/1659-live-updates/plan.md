# Notifications and live updates

Derived from [spec.md](./spec.md). Chunk layout matches Epic #1659 child Tasks; the urgent Web Push work is #1670 under Epic #1600 and is listed here only as a dependency.

## Goal

Ship JMAP Push in short-burst form on the existing per-user states, one push hub per browser, the mesh `check-now`, app adoption, inbox on push and in-app toasts, without holding a PHP-FPM worker. Design: [docs/architecture/notifications.md](../../../docs/architecture/notifications.md) and [docs/architecture/jmap-push.md](../../../docs/architecture/jmap-push.md).

## Budget

Draws from the shared-hosting request budget in `docs/realtime-capacity.md` (5 PHP-FPM workers, shared with signaling): about 20 push requests per minute per open browser at a 3 s retry. Displaces, once measured, most of the per-app polls (Notes, Contacts and Calendar every 10 s, Meet chat every 4 s, inbox every 15 s), which are heavier requests.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The JMAP session advertises `eventSourceUrl`, and the route answers 501. `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapSessionController.php` `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapStubController.php`
- Per-user account state is already a composite over accessible collections (`{count}:{id}:{token},…`). `path: packages/api/app/Services/Jmap/JmapAccountStateCodec.php` `path: packages/api/app/Services/Notes/NotebookRepository.php`
- `FileNode/get` returns the global `currentSeq()`; `changesSince` scans rows above a seq and filters by roots in PHP. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php`
- Visible Drive roots include account, group and member-share roots. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeAccountSupport.php`
- The `notifications` table has no change column; deliveries are one row per notification and channel. `path: packages/api/database/migrations/wgw/2026_09_12_000390_wgw_create_notifications.php`
- The shared `wgw-api` bucket is 600/min per account, keyed by username. `path: packages/api/app/Http/RateLimiting/WgwApiRateLimiters.php`
- The API authenticates with bearer tokens; the JWT carries no session id. `path: packages/apps/src/lib/api/wgw/http.ts` `path: packages/api/app/Services/Auth/JwtTokenService.php`
- Each JMAP adapter has `sync()` and a poll timer that skips while hidden. `path: packages/apps/src/lib/jmap-client/adapter/JmapNotesAdapter.ts`
- Cross-tab messaging helper. `path: packages/apps/src/lib/offline/core/cross-tab-topic.ts`
- Meet chat mesh acceleration: message previews plus content-free `channel-changed` and `notify-hint`. `path: packages/apps/src/meet-core/src/meet-mesh-sot.ts`
- Presence polls at 1.2 s while connecting, 4 s alone, 20 s once linked. `path: packages/apps/src/presence-core/src/presence-rtc-session.ts`
- Toast primitive. `path: packages/apps/src/ui/app-toast-callout.tsx`

## Considered

The design went through three external reviews on 2026-10-26. Each line is an alternative or a review point, and what was chosen.

**Transport**

- Considered: WebSockets or SSE held open — rejected: shared hosting has about five PHP-FPM workers, shared with signaling.
- Considered: hold mode as an admin setting (`WGW_JMAP_PUSH_HOLD_SECONDS`) — rejected in review 1: it is long-poll, against the signaling rule, and doubles the test surface.
- Considered: piggybacking hints on the presence mailbox (`HttpSignalingStore::insertServerMessage`) — rejected: presence polls only every 20 s once linked, the room caps at 32 peers, and it needs WebRTC.
- Considered: a plain JSON poll endpoint with `since=` — rejected: the RFC event source is already advertised, serves external JMAP clients, and leaves room for held connections on a separate pool later. Short-burst SSE is a poll with SSE framing, and the docs say so.
- Considered: `@microsoft/fetch-event-source` — rejected: last release April 2021, no reconnect when the server ends the stream normally, closes while hidden. An own reader of about a hundred lines.

**Source of truth**

- Considered: a new change-hint table filled by a listener on `EventDispatch`, with per-domain recipient resolvers — rejected: the Sabre synctokens and the existing per-user state composites already are the log and the rights filter.
- Considered: VJOURNAL as an internal log — rejected: VJOURNAL holds data (notes, chat, Docs threads), and `calendarchanges` already logs those collections.
- Considered (review 1): filtering Drive change rows per poll — replaced by a marker per visible root, bumped at write.
- Considered (review 1): fan-out per principal for Drive — rejected: a 200-member group folder would cost 200 upserts per write; per root costs one.
- Review 2: move and delete bump the old and new root sets; batches bump each root once; a missing marker row counts as 0.
- Review 3: the `FileNode` hash covers `root → marker` pairs, identity and value, so a share of an empty folder is visible.
- Review 1: the "Drive single-person shares" gap was not a gap (`rootsFor` includes share roots).

**Client**

- Considered (review 1 → 2): pending states with backoff retries and handover to a new leader — replaced in review 2 by an id rebuilt from confirmed per-type hashes; no pending list, no timer.
- Review 3: one sync in flight per type, and every subscribed app must confirm.
- Considered: the presence leader for the stream — rejected in review 1 for Web Locks, so a failing mesh cannot stop the safety net.
- Review 1: hashes are 128-bit; a collision would be a silent, permanent miss.
- Review 1: own rate-limit bucket per browser with a per-account ceiling; `429` falls back to the normal polls.

**Mesh**

- Considered: WebRTC as the preferred delivery carrying data for every app — rejected: the writer cannot know whom the mesh missed, external writers never touch it, and a payload is filtered by the sender's stale view of the ACL. The mesh only wakes; Meet chat keeps its preview as the one exception.
- Review 1: `check-now` reveals that someone wrote, so it goes only to targeted users; unknown → none. Targeting for active news taken over from #1607 (closed): notified usernames.
- Review 2: writes from an active collab room send no `check-now`.

**Active news**

- Aligned with #1605: only a visible window or a Meet call acks; hidden windows show nothing themselves; Web Push is the only OS notification path.
- Review 1: urgent `meet.started` skips the local-ack grace (#1670).
- Review 2: the after-response send is bounded (parallel, 1.5 s, 20 subscriptions), only `meet.started` is urgent.
- Review 3: delivery status per subscription; the service worker posts the item to the visible client (not only suppresses), so nothing is lost while push is down.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

1. Chunk `chunk-server` (event source, states, markers, limiter).
2. Chunk `chunk-client` after `chunk-server`; inside it the Web Locks leader, the confirmed-hash id and the SSE reader come first.
3. App chunks (`chunk-notes`, `chunk-drive`, `chunk-calendar`, `chunk-tasks`, `chunk-contacts`, `chunk-chat`) after `chunk-client`, in parallel.
4. `chunk-mesh` after `chunk-client`.
5. `chunk-inbox` after `chunk-server` and `chunk-client`; `chunk-toast` after `chunk-inbox`.
6. `chunk-metadata` has no dependency.
7. #1670 (urgent Web Push, under #1600) after #1601, #1605, `chunk-server`, `chunk-inbox` and `chunk-toast`.

## Open decisions

None — every choice for this work is made. The retry default (3 s) and the urgent cutoff (20 subscriptions) are fixed starting values; `chunk-server` and #1670 measure them with k6 and record the result in `docs/realtime-capacity.md`.

## Invariants

- With push unavailable, every app keeps syncing through its existing poll. A wrong change leaves apps stale whenever the event source fails. Proof: `path: packages/apps/src/lib/jmap-client/adapter/JmapNotesAdapter.test.ts` and `path: packages/apps/src/lib/jmap-client/adapter/JmapContactsAdapter.test.ts`.
- `FileNode/changes` keeps accepting the global sequence as `sinceState`. A wrong change breaks Drive sync for every client. Proof: `path: packages/api/tests/Feature/Jmap/JmapFileNodeMethodsTest.php`.
- The JMAP session keeps advertising `eventSourceUrl` with the RFC template variables. Proof: `path: packages/api/tests/Feature/Jmap/JmapSessionTest.php`.
- Inbox, local-ack and the VAPID sweep keep working. A wrong change silences or duplicates push. Proof: `path: packages/api/tests/Feature/Notify/VapidPushTest.php` and `path: packages/apps/src/notifications-core/src/notifications-host.test.tsx`.
- Meet chat mesh previews stay unchanged. Proof: `path: packages/apps/src/meet-core/src/meet-mesh-sot.test.ts`.
- Signaling is not slowed by push: no held connection. Proof: `path: packages/api/tests/Unit/Rtc/Signaling/HttpSignalingStoreTest.php`.
- Cross-tab fan-out delivers to every tab once. Proof: `path: packages/apps/src/lib/offline/core/cross-tab-topic.test.ts`.
- After `chunk-server`, main still works without the client chunk. Proof: `cmd: pnpm test:api-done-gate`.

## Chunks

### Chunk S: Server event source and states (#1660)

- **id:** `chunk-server`
- **Skill:** api, security, testing
- **Inputs:** `path: packages/api/app/Http/Controllers/Api/V1/Jmap/JmapStubController.php`, `path: packages/api/app/Services/Jmap/JmapAccountStateCodec.php`, `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php`, `path: packages/api/app/Http/RateLimiting/WgwApiRateLimiters.php`
- **Done when:** the acceptance criteria of #1660 hold, OpenAPI and typegen are updated, and the k6 push scenario result is in `docs/realtime-capacity.md`
- **Verify with:** `cmd: pnpm test:api-done-gate`
- **Parallel with:** `chunk-metadata`

### Chunk C: Client push hub (#1661)

- **id:** `chunk-client`
- **Skill:** workspace, client-transport, testing
- **Inputs:** `path: packages/apps/src/lib/api/wgw/http.ts`, `path: packages/apps/src/lib/offline/core/cross-tab-topic.ts`, `path: packages/apps/src/lib/jmap-client/adapter/JmapNotesAdapter.ts`
- **Done when:** the acceptance criteria of #1661 hold; Web Locks leader, confirmed-hash id and SSE reader land first
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** none

### Chunk M: Mesh check-now (#1662)

- **id:** `chunk-mesh`
- **Skill:** meet, workspace, testing
- **Inputs:** `path: packages/apps/src/meet-core/src/meet-mesh-sot.ts`, `path: packages/apps/src/presence-core/src/presence-envelope.ts`
- **Done when:** the acceptance criteria of #1662 hold, including targeted recipients from notifying mutations
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/meet-core src/presence-core`
- **Parallel with:** app chunks

### Chunk N: Notes (#1533)

- **id:** `chunk-notes`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/notes-core/src/use-notes-api.ts`
- **Done when:** the acceptance criteria of #1533 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/notes-core`
- **Parallel with:** `chunk-drive`, `chunk-calendar`, `chunk-tasks`, `chunk-contacts`, `chunk-chat`

### Chunk D: Drive and Docs home (#1663)

- **id:** `chunk-drive`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/lib/offline/drive/use-drive-file-node-inbound.ts`
- **Done when:** the acceptance criteria of #1663 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/lib/offline/drive`
- **Parallel with:** other app chunks

### Chunk K: Calendar (#1664)

- **id:** `chunk-calendar`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/calendar-core/src/use-calendar-surface.ts`
- **Done when:** the acceptance criteria of #1664 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/calendar-core`
- **Parallel with:** other app chunks

### Chunk T: Tasks (#1665)

- **id:** `chunk-tasks`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/tasks-core/src/tasks-route-search.ts`
- **Done when:** the acceptance criteria of #1665 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/tasks-core`
- **Parallel with:** other app chunks

### Chunk O: Contacts (#1666)

- **id:** `chunk-contacts`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/contacts-core/src/use-contacts-api.ts`
- **Done when:** the acceptance criteria of #1666 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/contacts-core`
- **Parallel with:** other app chunks

### Chunk H: Meet chat (#1667)

- **id:** `chunk-chat`
- **Skill:** meet, testing
- **Inputs:** `path: packages/apps/src/meet-core/src/use-meet-chat-api.ts`
- **Done when:** the acceptance criteria of #1667 hold
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/meet-core`
- **Parallel with:** other app chunks

### Chunk I: Inbox on push (#1668)

- **id:** `chunk-inbox`
- **Skill:** workspace, testing
- **Inputs:** `path: packages/apps/src/notifications-core/src/notifications-provider.tsx`
- **Done when:** the acceptance criteria of #1668 hold, local-ack per #1605
- **Verify with:** `cmd: pnpm --dir packages/apps exec vitest run src/notifications-core`
- **Parallel with:** app chunks

### Chunk P: In-app toasts (#1669)

- **id:** `chunk-toast`
- **Skill:** apps-ui, accessibility, storybook, testing
- **Inputs:** `path: packages/apps/src/ui/app-toast-callout.tsx`, `path: packages/apps/src/ui/sonner.tsx`
- **Done when:** the acceptance criteria of #1669 hold, with a mock-tier story and the a11y check
- **Verify with:** `cmd: pnpm test:apps-done-gate`
- **Parallel with:** none

### Chunk R: Collection rename and colour (#1671)

- **id:** `chunk-metadata`
- **Skill:** api, testing
- **Inputs:** `path: packages/api/app/Services/Notes/NotebookRepository.php`, `path: packages/api/app/Services/Calendars/CalendarRepository.php`
- **Done when:** the acceptance criteria of #1671 hold
- **Verify with:** `cmd: pnpm test:api-done-gate`
- **Parallel with:** `chunk-server`

### Chunk V: Cross-chunk verify

- **id:** `chunk-verify`
- **Skill:** code-review, testing
- **Inputs:** [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md)
- **Done when:** verifier `PASS` or `PASS_WITH_NITS`, and the parent ran the [done-checklist](../../skills/developer/done-checklist.md)
- **Verify with:** `cmd: pnpm run ci:quality`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature tests (sharee/non-sharee, CalDAV write, Drive roots incl. empty share, `Last-Event-ID`, limits) → implement → `pnpm test:api-done-gate`
- [ ] UI: Vitest for parser, hub, leader handover, confirmed hashes, one-sync-per-type, coalescing → mock-tier story for the toast → `pnpm test:apps-done-gate`
- [ ] Load: k6 push scenario, reads and writes, busy FPM workers

## Doc updates (only if user wants)

- `docs/realtime-capacity.md`: the k6 push result (part of `chunk-server`).
