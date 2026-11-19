Source: #2284 (body-hash: 7ae460e8)
Goal: WeGotWorkspace/Product#153

# Traffic budget for shared hosting

## Goal

Keep one browser of one user — every tab, installed PWA window and service worker together — inside a request budget that a shared host's per-IP firewall tolerates: ≤ 30 requests/min while someone works, ≤ 10/min when visible but idle, ≤ 4/min with every tab hidden, ≤ 30 in any 10 s outside first loads and user actions, and a shared backoff while the server is unreachable or answers 429/503. The organising rule is the push doorbell: one JMAP push stream per browser is the only live channel; it says *that* something changed for this user and the app pulls; polls remain only as a backup while push is unhealthy and as a short fast poll while a WebRTC peer connects. The work removes duplicate fetching (one syncing tab per browser for every app; threads, signaling rooms, Meet call activity and app backup polls behind push), slows polls when nobody uses the workspace, paces first downloads browser-wide, and adds a service-worker governor whose budget the server announces from env per install channel.

## Non-goals

- A server-side rate limiter that answers 429 before the host's firewall.
- Native DAV clients (they poll on their own schedule).
- Anything visible on screen; changes are to request timing and sources only.
- The service worker update never activating while tabs stay open (missing `SKIP_WAITING` handler) — separate bug.
- Working around a host that blocks the workspace entirely.

## Affected packages

- `packages/apps` — Calendar, Docs, Meet, Contacts, offline core, RTC cadence, JMAP push transport, service worker, e2e harness.
- `packages/api` — `DocThread` push type, `TrafficBudget` profiles, budget response header middleware, `config/wgw.php`.
- `docs` — `docs/realtime-capacity.md`, `docs/architecture/jmap-push.md`.

## Technical constraints

- The firewall counts per IP. The budget is per browser; an office behind one IP needs the host to whitelist it (documented, not solved in code).
- JMAP push is short-burst SSE (`GET /api/v1/jmap/events/{types}/{closeafter}/{ping}`), pull-only: `JmapPushStateResolver` computes states per caller, there is no fan-out. A new push type is a new state source in that resolver, not a server-side event.
- One syncing tab per browser already exists for push (`jmap-push-hub`, Web Locks) and for the inbound syncs (`useSharedInboundSync`). New consumers (Calendar) reuse those hooks; app packages must not import each other (`eslint-import-boundaries.mjs`), so shared hooks live under `src/lib`.
- The service worker is the only place every tab's fetch passes through. It may delay background reads; it must never delay writes or requests the user waits for, and must never reorder writes.
- Budget numbers come from the server (`X-WGW-Traffic-Budget`), so one client build serves zip (shared) and Docker/Helm (standard) installs. 0 means unpaced.
- Shared hosting: no long-lived connections, no extra processes (README promise; `docs/realtime-capacity.md` 5 FPM children profile).

- Push cost budget: a push request with every type stays ≤ 25 ms on the reference stack (measured ~14 ms for 13 types, ~0.3 ms per type). Each new type's state is one indexed query per caller and excludes heartbeat fields (`seen_at`), or it would change on every poll.
- Signaling peers expire after `peerTimeoutSeconds` (60–90 s) without a poll; a room behind the doorbell keeps a heartbeat poll below that.
- Push cadence 3 s active, 6 s idle, 30 s hidden (20/6/2 per minute) is most of the per-browser budget; little else may poll.

## Edge cases

- Service worker not controlling yet (first load, private window, SW disabled): client-side pacing (pacer, idle cadence, probe backoff) still holds the budget; the governor is a second line.
- Several tabs claim pacer slots at once: Web Lock makes read-and-reserve atomic; without Web Locks or `localStorage` each tab falls back to its own schedule.
- A stored next-slot time far in the future (clock change): ignored after 10 intervals.
- Push down: the Docs threads poll and the Calendar invitations poll resume at their old cadence.
- Calendar with no Tasks or Contacts cache: one Tasks bootstrap; invitee suggestions start empty and fetch once only when the user searches with no cache at all.
- A colleague opens a document the user is alone in: found within one slow interval (6 s alone after 30 s; 20 s when the user is idle). Accepted in Product#153 Decisions.
- Push healthy vs connected: "healthy" means a push response within the last two rounds; backup polls key on healthy, not on an open connection.
- A user with a peer in a room on another device: the `RtcRoom` state is per account, so both devices' streams see the change; each device's room then polls once. Acceptable (one extra request per change).
- Contacts photo pass: cards render with initials until their photo arrives; Calendar invitee search needs no photos.
- `Retry-After` larger than the brake cap: capped at 5 minutes.
- A coalesced read fails: not shared; the next caller retries.
