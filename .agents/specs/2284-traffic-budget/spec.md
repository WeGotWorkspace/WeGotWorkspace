Source: #2284 (body-hash: 56d94a07)
Goal: WeGotWorkspace/Product#153

# Traffic budget for shared hosting

## Goal

Keep one browser of one user — every tab, installed PWA window and service worker together — inside a request budget that a shared host's per-IP firewall tolerates: ≤ 30 requests/min while someone works, ≤ 10/min when visible but idle, ≤ 4/min with every tab hidden, ≤ 30 in any 10 s outside first loads and user actions, and a shared backoff while the server is unreachable or answers 429/503. The work removes duplicate fetching (one syncing tab per browser for every app, push instead of polls), slows polls when nobody uses the workspace, paces first downloads browser-wide, and adds a service-worker governor whose budget the server announces from env per install channel.

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

## Edge cases

- Service worker not controlling yet (first load, private window, SW disabled): client-side pacing (pacer, idle cadence, probe backoff) still holds the budget; the governor is a second line.
- Several tabs claim pacer slots at once: Web Lock makes read-and-reserve atomic; without Web Locks or `localStorage` each tab falls back to its own schedule.
- A stored next-slot time far in the future (clock change): ignored after 10 intervals.
- Push down: the Docs threads poll and the Calendar invitations poll resume at their old cadence.
- Calendar with no Tasks or Contacts cache: one Tasks bootstrap; invitee suggestions start empty and fetch once only when the user searches with no cache at all.
- A colleague opens a document the user is alone in: found within one slow interval (6 s alone after 30 s; 20 s when the user is idle). Accepted in Product#153 Decisions.
- `Retry-After` larger than the brake cap: capped at 5 minutes.
- A coalesced read fails: not shared; the next caller retries.
