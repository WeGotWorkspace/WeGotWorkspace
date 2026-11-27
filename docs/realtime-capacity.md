# Real-time capacity on shared hosting

Reference profile: PHP-FPM with `pm.max_children = 5`. One child serves one request. The instance does not call a third party for real-time traffic.

Clients poll their own signaling route only while a peer connects. Otherwise the JMAP push stream is the doorbell (#2294): its `RtcRoom` state changes when a peer joins or leaves a room the user is in, or a message reaches one of their peers, and each of the user's rooms then polls once. A room behind the doorbell does not poll at all: every push read names the browser's own live peers (`X-WGW-Rtc-Peers`) and refreshes their `seen_at`, so a lone peer stays on the roster (#2287; `packages/apps/src/lib/rtc/session/poll-cadence.ts`, `push-heartbeat-peers.ts`, `room-doorbell.ts`). Only peers the browser names are refreshed, so a closed laptop's peers still expire after the peer timeout (Meet 60 s, Docs and presence 90 s). The server refreshes a named peer at most every 20 s, and a Docs or presence peer only after the access check a room poll runs (share grant or Team membership), so a revoked member leaves a quiet room within about 30 s. A room on a channel the push read does not cover heartbeats every 30 s:

| Channel | While connecting | Push connected, nobody connecting | Push down: nobody reachable | Push down: every reachable peer linked |
| --- | --- | --- | --- | --- |
| Meet | 400 ms, then 1.2 s | no poll (push read is the heartbeat) | 4 s when alone | 4 s |
| Docs | 400 ms, then 1.2 s | no poll (push read is the heartbeat) | 2 s | 5 s |
| Presence | 400 ms, then 1.2 s | no poll (push read is the heartbeat) | 4 s | 20 s |

The push stream itself reconnects every 3 s while someone works, every 6 s while a tab is visible but nobody touched any tab of the browser for 2 minutes (`lib/activity/user-activity.ts`; the first input wakes it at once), and every 30 s while every tab is hidden. A newcomer is therefore seen within one push round plus one poll: about 3.5 s active, about 7 s idle.

In Docs and Presence a peer counts as connecting for 20 s after it appears on the roster or its link drops (`UNLINKED_PEER_FAST_WINDOW_MS`). After that it no longer holds the room at 1.2 s: a page that closed without its leave beacon, or a browser whose WebRTC never opens, used to keep every room it shared at the connecting cadence (#2156). A Docs peer linked through the presence mesh (collab reuse) counts as linked. With push down, the 2 s for an empty Docs room is also how long a newcomer who is not linked yet waits to be found.

Docs over the HTTP fallback (no data channel) polls 1 s while edits flow and for 30 s after the last one, then 2 s.

Clients do not post session samples. The budget below is signaling polls only.

Presence has one room per own Team (#1921). With more than two Teams, each room's slow intervals (alone, idle) are stretched by `rooms / 2`, so a user in 4 Teams polls 2× one room, never more. Measured for one tab: 14.9 /min alone in one room, 30.0 /min alone in 4 Team rooms; 3.0 /min and 5.3 /min with a linked colleague.

## Scenario

`tools/load/rtc-shared-hosting.k6.js` drives that mix over HTTP:

- N presence peers in one Team room `p_groups.capacity` (default N = 8). Presence has one room per Team (#1921); a user in several Teams polls each of their rooms.
- two Docs rooms, two peers each
- one 6-person call (the default Meet cap)
- a join burst of 10 peers
- a later iteration where a 10th participant joins the call

Run it against a host whose FPM pool is capped at 5 children:

```bash
k6 run -e BASE_URL=https://example.test tools/load/rtc-shared-hosting.k6.js
```

## Sizing result

Rates below are the polls that mix produces. They come from the cadence above, not from a stopwatch on a rented server. Five children finish `60000 / poll_ms * 5` polls a minute. Compare the scenario rate to that ceiling.

| Slice | Peers | Cadence | Polls per minute |
| --- | --- | --- | --- |
| Presence, steady | 8 | 20 s | 24 |
| Two Docs rooms, steady | 4 | 5 s | 48 |
| 6-person call, steady | 6 | 4 s | 90 |
| **Reference mix, steady** | **18** |  | **162** |
| Join burst, or the 10th participant while peers are still connecting | 10 | 400 ms | 1500 |

| If one signaling poll takes | Polls per minute with 5 children | Reference mix (162/min) | Connecting burst (1500/min) |
| --- | --- | --- | --- |
| 50 ms | 6000 | about 3% of the pool | about 25% of the pool |
| 200 ms | 1500 | about 11% of the pool | the pool is full for that short window |

The burst is the constraint. It lasts until ICE settles and Meet drops back to a 4-second poll. A poll that stays under 200 ms fits the reference mix on this profile, including the 10th joiner, as long as that connecting window is brief. A poll slower than 200 ms fills all five children for the whole burst.

Confirm the assumption on the host with the k6 script.

## Browser traffic budget (#2291)

A shared host's firewall may block an IP above about 60 requests a minute, and it counts every tab, window and device behind that IP. Every API answer therefore carries `X-WGW-Traffic-Budget: background=N; bulk=N; burst=N`, and the service worker of each browser (the one place all its tabs' requests pass) paces to it:

- **Background** (the push stream, signaling events, `…/changes`, notification lists, anything marked `X-WGW-Traffic: background`) draws from one token bucket per browser: `background` per minute, `burst` at once, a request waits at most 30 s.
- **Bulk** (marked `X-WGW-Traffic: bulk`: first downloads, prefetch) goes one at a time, `bulk` per minute.
- **Session reads** (`settings/state`, `me`, `jmap/session`) of one signed-in session share one answer for 15 s; a write drops it.
- **Everything else** (foreground reads, writes) is never delayed; it takes no token, so a busy download cannot starve the push doorbell.
- A network error, 429 or 503 brakes background and bulk (2 s doubling to 60 s, or `Retry-After`, at most 5 minutes).

| Profile | background / min | bulk / min | burst | Default for |
| --- | --- | --- | --- | --- |
| `shared` | 30 | 20 | 10 | ZIP installs |
| `standard` | 120 | 120 | 30 | Docker and Kubernetes (`WGW_INSTALL_CHANNEL=docker`) |
| `off` | 0 | 0 | 0 | — |

`WGW_TRAFFIC_PROFILE` picks the profile; `WGW_TRAFFIC_BACKGROUND_PER_MINUTE`, `WGW_TRAFFIC_BULK_PER_MINUTE` and `WGW_TRAFFIC_BURST` override one number each (clamped 0–10000; `0` turns pacing off for the two per-minute numbers, a burst of `0` is applied as `1`). Until a browser has read the header it holds the `shared` numbers. Without a service worker (first visit, private window) the client's own pacing (pacer, idle cadence) still holds; the governor is the second line. A browser that is idle or has every tab hidden is slowed by the clients' cadence (6 s and 30 s push), not by this budget.

## JMAP push (event source)

Open apps learn about changes through short-burst requests to `GET /api/v1/jmap/events/{types}/{closeafter}/{ping}` ([architecture/jmap-push.md](architecture/jmap-push.md)). Each request computes the per-type states, answers at once and closes. The client reconnects after `retry:` (`WGW_JMAP_PUSH_RETRY_MS`, default 3000 ms). A request never holds an FPM child open.

The push route has its own rate limit (`wgw-jmap-push`): 60 requests a minute per user and browser (`X-WGW-Browser-Id`), and 300 a minute per account. Requests over the limit get a 429 with `Retry-After`. Push does not spend the account's `wgw-api` budget.

### Scenario

Set `PUSH_USER` and `PUSH_PASSWORD` to add push scenarios to the k6 script:

- `PUSH_BROWSERS` open apps (default 16), each polling the event source every `retry:` with `Last-Event-ID`
- one writer doing single Drive uploads (WebDAV PUT) into `push-load/`
- one writer doing a batch `FileNode/set` of `PUSH_BATCH_SIZE` creates (default 10)

`PUSH_ONLY=1` skips the real-time mix. With `WGW_JMAP_PUSH_SERVER_TIMING=1` on the server, every push response carries a `Server-Timing` header per state source; k6 reports those as `push_state_<source>_ms`.

- `PUSH_USER` may list several accounts with the same `PUSH_PASSWORD` (`load1,load2,load3`); the browsers spread over them. Writes go to the first.
- `PUSH_INTERVAL_MS` makes every browser reconnect at that interval instead of the server's `retry:`, as a browser with a linked presence mesh does (5000).
- `FPM_STATUS_URL` points at the pool's `pm.status_path`; a sampler reads it four times a second and reports busy children as `fpm_busy_children` (the status request itself is subtracted).
- Each browser starts at a random point in its interval, as real browsers do. Without that, every browser fires in the same millisecond and the pool sees bursts that no real install has.

```bash
k6 run -e BASE_URL=https://example.test -e PUSH_USER=… -e PUSH_PASSWORD=… tools/load/rtc-shared-hosting.k6.js
```

One account allows 300 push requests a minute, about 15 browsers at a 3-second interval, so more browsers need more accounts in `PUSH_USER`.

### Local measurement

Measured on a developer laptop (Apple Silicon), not on shared hosting: `php -S` with `PHP_CLI_SERVER_WORKERS=5`, SQLite, one account with an almost empty data set, `PUSH_ONLY=1`.

| Run | HTTP requests (push and writes) | Push p95 (avg) | Batch `FileNode/set`, 10 creates, p95 | Single WebDAV PUT, p95 |
| --- | --- | --- | --- | --- |
| 5 browsers, 1 min | 138, 0 failed | 50.6 ms (38.6 ms) | 59.2 ms | 203.7 ms |
| 12 browsers, 2 min | 562, 1 failed | 65.8 ms (39.7 ms) | 63.9 ms | 205.1 ms |

State cost per source inside one push request, p95 at 12 browsers: notes 1.9 ms, tasks 1.1 ms, contacts 1.1 ms, files 0.9 ms, chat 0.9 ms, calendars 0.9 ms, inbox 0.2 ms. The rest of the request time is outside the state code (framework boot, authentication, rate limiter).

Caveats:

- The single PUT sits at a flat 200 ms in both runs, while the batch of 10 creates takes about 60 ms. That points to a local network artefact (such as delayed ACK) rather than the marker upsert, but it is not proven, and this number does not isolate the write-side cost.
- The one failed request in the 12-browser run left no line in the server or application log; its cause is unknown.
- `php -S` does not report busy workers, so the FPM busy-children share is not measured. At about 40 ms average, 12 browsers polling every 3 seconds (240 a minute) keep about 0.16 of one child busy (Little's law), roughly 3% of a 5-child pool.

### 3 s or 5 s, by mesh state (#1943)

A browser reconnects every 5 s instead of 3 s while its presence mesh has held a link ([architecture/jmap-push.md](architecture/jmap-push.md#interval-by-mesh-state)). Measured on 2026-11-05 on a developer laptop (Apple Silicon), with PHP-FPM this time: `pm = static`, `pm.max_children = 5`, OPcache on, SQLite, a near-empty data set, three accounts, `PUSH_ONLY=1`, 2 minutes per row. The Drive writers run in every row (12 single PUTs and 2 batches of 10 a minute), so busy children include them.

| Browsers | Interval | Push requests per minute | Push median / p95 | Busy FPM children, average | Busy children, max |
|---|---|---|---|---|---|
| 5 | 3 s | 96 | 44 ms / 85 ms | 0.11 (2% of the pool) | 3 |
| 5 | 5 s | 57 | 48 ms / 202 ms | 0.12 (2%) | 2 |
| 16 | 3 s | 302 | 47 ms / 234 ms | 0.51 (10%) | 4 |
| 16 | 5 s | 180 | 48 ms / 294 ms | 0.32 (6%) | 4 |
| 32 | 3 s | 605 | 41 ms / 188 ms | 0.73 (15%) | 4 |
| 32 | 5 s | 363 | 42 ms / 90 ms | 0.32 (6%) | 4 |

- 5 s cuts push requests by 40% at every size. That is the saving on a host where every browser has a linked mesh; a browser without one keeps 3 s.
- At 16 and 32 browsers the average busy children drop by 35–55%. At 5 browsers push is a small share next to the Drive writers, and the difference is within noise.
- The median request stays at 41–48 ms. The p95 and the maximum move between runs without a pattern: other work on the laptop (load average about 7 during these runs) set them more than the interval did. They are not a result.
- A first pass without the random start had all browsers in step: at 16 browsers and 3 s, p95 255 ms and 4 of 5 children busy at the 95th percentile, against an average of 0.35. Bursts, not the average, fill a small pool.

**Still to do:** run the push scenario on a host with `pm.max_children = 5`, MySQL and a realistic data set, and record push p95, write p95 and busy children here.

## Urgent Web Push (after-response send)

A meeting start (`meet.started`, #1670) sends its Web Push right after the response, on the PHP worker that served the write: at most 20 subscriptions per event, all at once over curl multi, within 1.5 s ([architecture/notifications.md](architecture/notifications.md), "Urgent active news"). That worker serves nothing else until the send is done.

### Scenario

Set `URGENT_USER` / `URGENT_PASSWORD` (who starts the meetings) and `URGENT_RECIPIENT` / `URGENT_RECIPIENT_PASSWORD` to add the `urgent` scenario; `URGENT_ONLY=1` runs it alone. Each iteration gives the recipient `URGENT_SUBSCRIPTIONS` push subscriptions, creates a meeting channel shared with them, and joins it, which starts the meeting. Right after the join's response a probe (`GET /api/v1/health`) goes out. Run the API with **one** PHP worker (`pm.max_children = 1`, or the built-in server with `PHP_CLI_SERVER_WORKERS=1`): the probe then waits until the send is done, so `urgent_worker_busy_ms` (join start to probe end, minus an idle probe) is how long one meeting start holds a worker. The subscriptions point at FCM with made-up tokens, so every send is a real TLS round trip that FCM answers with 410; the server prunes them and the next iteration posts them again. `WGW_PUSH_URGENT_MAX_SUBSCRIPTIONS` raises the cap for a measurement only.

### Measured cutoff (2026-11-03)

PHP built-in server with one worker, SQLite, on a MacBook over a home connection to FCM. Ten meeting starts per row (five for the uncapped 40). Encryption and the push round trips are both inside the numbers.

| Subscriptions of the recipient | Cap | Sent after the response | `urgent_worker_busy_ms` median | p95 | max |
|---|---|---|---|---|---|
| 0 | 20 | 0 | 16 ms | 37 ms | 45 ms |
| 5 | 20 | 5 | 138 ms | 230 ms | 245 ms |
| 10 | 20 | 10 | 144 ms | 215 ms | 230 ms |
| 20 | 20 | 20 | 181 ms | 236 ms | 249 ms |
| 40 | 20 | 20 (20 left for the sweep) | 179 ms | 243 ms | 266 ms |
| 40 | 40 | 40 | 316 ms | 616 ms | 651 ms |

Up to 20 the cost is one round trip plus a little encryption per subscription; above 20 the tail grows (one slow handshake holds the whole batch). **The cutoff stays at 20**: a meeting start holds a worker for about 0.2 s, well inside the 1.5 s deadline, and a recipient with more devices gets the rest on the next cron tick. Not measured yet: a shared host with `pm.max_children = 5` and a slower CPU, where encryption weighs more.

## Requests per browser (#2284)

A shared host counts requests per IP, and a router puts every tab, PWA window and device of an office behind one. A host that flagged "more than 60 requests a minute" blocked a developer's IP; its log showed peaks of 1277 a minute. The suite therefore has a budget per browser, and a harness that measures it.

### Budget

| Situation | Budget |
| --- | --- |
| Active (someone touches a tab) | at most 30 a minute |
| Idle (nobody touched any tab for 2 minutes) | at most 10 a minute |
| Every tab hidden | at most 4 a minute |
| Any 10 seconds | at most 30 requests |
| Cold start: a fresh browser opens five apps, 2000 contacts, 40 docs | fewer than 120 in minute 1, fewer than 40 a minute after |
| One push request with every type | at most 25 ms on the reference stack |

Browsers add up. Two people with five tabs each can reach 60 a minute on the active budget alone; ten people would need a host limit of 300 or more a minute for their shared IP.

### Measured

Local stack on one Mac (PHP built-in server, SQLite, Vite dev with the service worker on, one run at a time), fresh browser context, 3-minute window per scenario, every `/api` request of the pages and of the service worker counted. One run per row unless stated. "Before" is `main` on 2026-11-19 (`6aa30fc55`, an earlier version of the same scenarios on the small dev data set). "After" is `main` on 2026-11-25 (`4033aa291`) on a book with 2000 contacts and 40 docs in the Team folder, so the first minutes of every "after" row include those offline downloads (paced to 20 a minute). Compare the last minute to judge the steady state, and treat the 3-minute window as too short to show it for the downloads.

| Scenario | Before: per minute (busiest 10 s) | After: per minute (busiest 10 s) |
| --- | --- | --- |
| One Docs tab, idle | 80 / 80 / 81 (16) | 37 / 25 / 10 (8) |
| One Docs tab, clicking every 20 s | not measured | 40 / 32 / 20 (10) |
| Five tabs, Docs in front, idle | 82 / 69 / 69 (18) | 43 / 34 / 32 (10); in an 8-minute run 43 / 35 / 32 / 24 / 10 / 11 / 11 / 11 |
| Five tabs, switching every 15 s | 83 / 75 / 75 (34) | 55 / 50 / 48 (16) |
| Calendar and Contacts, switching every 15 s | 73 / 74 / 74 (28) | 53 / 31 / 28 (14) |
| Five tabs, connection drops for 60 s, returns | 83 / 88 / 85 (20) | 59 / 98 / 31 (44; 79 attempts failed while blocked) |
| Cold start, five apps | 397 / 48 / 48 (264; small address book) | 215 / 42 / 32, 204 / 42 / 33, 224 / 41 / 34 (126 to 146) |
| One push request with every type (16 types), median, p95 | 14 ms for 13 types | 16–17 ms, 19–20 ms (three runs of 200) |

What this meets and does not meet:

- **Met:** the push request stays under 25 ms. One Docs tab idle reaches 10 a minute in its third minute. In the cold-start run whose timeline was read bucket by bucket, about 190 requests went out in the first 20 seconds and no later 10 s window held more than 12.
- **Not met:** cold start minute 1 (204 to 224, target under 120) and minute 2 (41 to 42, target under 40). Five idle tabs make 32 in the third minute (budget 10), because that minute still holds paced doc bodies and contact pages; in an 8-minute run they settle at 11 a minute from minute 5 (10 push requests and one `TeamMember/get`). Tab switching makes 48 to 55 a minute against 30. A dropped connection followed by recovery sends 44 requests in one 10 s window against 30.
- With the service-worker governor (PR #2364, head `3d067ed93`, based on `main` of 2026-11-24; the API had no budget header, so the `shared` defaults applied; one run each): cold start 186 / 29 / 28 (busiest 10 s: 85), five idle tabs 40 / 23 / 30 (12), connection drop 40 / 23 / 30 (12; 24 attempts failed while blocked, against 79 without it). In the 8-minute idle run it also settles at 11 a minute. The five-tab and connection-drop runs gave the same per-minute counts although their timelines differ; they are probably the governor's token buckets, which was not checked.
- Not measured: photos, several Teams, a second user, a window longer than 3 minutes, a production build, a real host.

### Cold start on a large tree (#2063)

A fresh browser opens one app alone, Drive or Docs, on an account whose home holds 20,000 files and folders (400 folders of 49 files, 2,000 of them Markdown; 20,093 live nodes on the server in all). The scenario `cold start on a large tree` counts every listing request (`FileNode/query`, `/search/results`, the REST listings) until none was sent for 90 s, and labels each one: the keyset walk, a folder listing (`parentId`), the top-level roots lookup (`isTopLevel`) or the search route. Same Mac, same data set, production build (`vite build` + `vite preview`) against an API from the same checkout, one run each on 2026-11-27. "Before" is `main` at `da19686dc`, before the file tree; "after" is `main` at `e94b5ce2f`, with every #2063 chunk.

| App alone | Before: listing requests | After: listing requests | Before: all requests per minute (busiest 10 s) | After: all requests per minute (busiest 10 s) |
| --- | --- | --- | --- | --- |
| Drive | 1,244: 1,224 folder listings, 7 search, 7 roots, 4 name lookups, 2 starred; the last after 74 s | 10: walk 3 (15 + 16 + 16 pages), 4 roots, 2 starred, 1 folder; the last after 6 s | 903 / 450 / 23 (583) | 65 / 25 (37) |
| Docs | 479: 407 folder listings, 64 search, 3 starred, 3 shared with me, 2 roots; the last after 15 s | 7: walk 3, 2 starred, 1 roots, 1 search; the last after 7 s | 553 / 35 (365) | 70 / 18 (40) |

- **Met:** the first sync of the tree takes 3 listing requests in both apps (the bound is at most 3 for 20,000 nodes), and it is the same walk whichever app opens first.
- **Left over** (not part of the walk, sent once per open): Drive sends the top-level roots lookup four times in parallel, plus one listing of the open folder; Docs sends one browse `GET /search/results` before it reads the tree, plus one roots lookup; both read `GET /files/starred` twice. Each is one request and does not grow with the tree.
- The "after" minutes still hold the other start-up requests (session, settings, push) and the paced offline downloads; the per-minute columns are all requests, not only listings.

To repeat it: write the folders straight into a copy of the data directory (`<data>/files/users/<user>/…`), then build the file and search indexes once per checkout with `SearchReindexRunner::run()` (it runs the FileNode reindex first), so both builds meet the same index. Run `-g "large tree"` with `WGW_TRAFFIC_TREE_MAX_MINUTES` (default 30) as the upper bound per app.

### Measuring the browser budget

The harness is `packages/apps/e2e/traffic-budget.spec.ts` with `e2e/helpers/traffic-meter.ts` and `playwright.traffic.config.mjs`. It is not part of the live tier and not part of CI: the scenarios take about 25 minutes together. A meter counts requests per tab (`sw` for the service worker's own), per endpoint group and per minute, and writes `test-results/traffic/<scenario>.json` with the busiest 10 s, a timeline and the window in epoch milliseconds.

1. Start an API and the app on ports nothing else uses. Playwright reuses a server that already answers on the default ports, so another checkout's stack would be measured by mistake (`lsof -nP -iTCP:9080 -iTCP:5173 -sTCP:LISTEN`). The defaults are API `127.0.0.1:9080` and app `127.0.0.1:5173`; `WGW_E2E_API_URL`, `WGW_APPS_E2E_BASE_URL` and `WGW_APPS_E2E_NO_SERVER=1` point the harness at stacks you started yourself.
2. Run it from `packages/apps`:

```bash
WGW_TRAFFIC_MINUTES=3 pnpm exec playwright test --config playwright.traffic.config.mjs
```

   `-g "cold start"` runs one scenario. `WGW_TRAFFIC_MINUTES` is the window per scenario (default 3). `WGW_TRAFFIC_ENFORCE=1` fails a scenario that breaks the budget above; without it the run prints `OVER BUDGET` lines and passes. `WGW_TRAFFIC_OUT` moves the reports. `WGW_TRAFFIC_CONTACTS` (default 2000) and `WGW_TRAFFIC_DOCS` (default 40) size the cold-start data; the spec tops them up and never removes them.
3. The scenarios: one Docs tab idle; one Docs tab with a click every 20 s; five tabs idle; five tabs switching every 15 s; Calendar and Contacts switching; a 60 s connection drop; the cold start; the cold start of Drive or Docs alone on a large tree (#2063, above); and the cost of a push request with every type (plain requests, no browser).
4. Cross-check with the API's own log. With the PHP built-in server the log has one `Accepted` line per request:

```bash
node e2e/traffic-crosscheck.mjs test-results/traffic/suite-cold-start.json api-server.log
```

   It prints the browser's per-minute counts next to the server's. They agree within a few requests (the log has whole seconds). Use a log of an API that nothing else talks to during the run: in one session a second client on the default port added 15 to 28 requests to a minute that the browser never sent. A browser count above the server's means requests that never arrived (blocked or cached); a count below means requests the meter missed.
5. To compare a build with and without the service-worker governor (#2291), run the same scenarios against each build's app on the same API and book, one after the other.

### Settings per install channel

| Setting | ZIP / SFTP (`packages/api/.env`) | Docker and Kubernetes (`api.env`, `WGW_INSTALL_CHANNEL=docker`) |
| --- | --- | --- |
| `WGW_JMAP_PUSH_RETRY_MS` | 3000. Raise to 5000 on a very small host: push requests drop by about 40%, live updates arrive up to 2 s later. | Same default and meaning. |
| `WGW_TRAFFIC_PROFILE` (governor, #2291) | `shared` by default: 30 background, 20 bulk a minute, burst 10. | `standard` by default: 120 / 120 / 30. Kubernetes uses the image, so it is `standard` too. |
| `WGW_TRAFFIC_BACKGROUND_PER_MINUTE`, `WGW_TRAFFIC_BULK_PER_MINUTE`, `WGW_TRAFFIC_BURST` (governor, #2291) | Optional overrides of one number of the profile. | Same. |

The three `WGW_TRAFFIC_*` settings exist in the release that includes the service-worker governor (#2291). The push route also holds a fixed limit of 60 requests a minute per browser and 300 per account; that is not a setting.

### Offices: ask the host to allow the office IP

Per-browser numbers cannot keep a whole office under a per-IP threshold. If the host limits requests per IP, ask it to allowlist the office's outgoing IP address (and the VPN's, if people connect through one), or to raise the limit for that address. Multiply the active budget by the number of people who work at the same time: 10 people at 30 a minute need a limit of at least 300 a minute, plus margin for their cold starts. Also ask for the exact limit and whether it counts static files, because the budget above counts API requests only. Without an allowlist, a host limit of 60 a minute fits about two people working at the budget.
