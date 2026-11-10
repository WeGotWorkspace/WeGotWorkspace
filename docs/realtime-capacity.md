# Real-time capacity on shared hosting

Reference profile: PHP-FPM with `pm.max_children = 5`. One child serves one request. The instance does not call a third party for real-time traffic.

Clients poll their own signaling route. After a room is connected the cadence backs off (`packages/apps/src/lib/rtc/session/poll-cadence.ts`):

| Channel | While connecting | Once the room is stable |
| --- | --- | --- |
| Meet | 400 ms | 4 s |
| Docs | 400 ms | 15 s |
| Presence | 400 ms | 1.2 s (no extra backoff) |

Clients do not post session samples. The budget below is signaling polls only.

Presence has one room per own Team (#1921). With more than two Teams, each room's slow intervals (alone, idle) are stretched by `rooms / 2`, so a user in 4 Teams polls 2× one room, never more. Measured for one tab: 14.9 /min alone in one room, 30.0 /min alone in 4 Team rooms; 3.0 /min and 5.3 /min with a linked colleague.

## Scenario

`tools/load/rtc-shared-hosting.k6.js` drives that mix over HTTP:

- N presence peers in one Team room `p_groups.capacity` (default N = 8). Presence has one room per Team (#1921); a user in several Teams polls each of their rooms.
- two Docs rooms, two peers each
- one 4-person call
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
| Presence, steady | 8 | 1.2 s | 400 |
| Two Docs rooms, steady | 4 | 15 s | 16 |
| 4-person call, steady | 4 | 4 s | 60 |
| **Reference mix, steady** | **16** |  | **476** |
| Join burst, or the 10th participant while peers are still connecting | 10 | 400 ms | 1500 |

| If one signaling poll takes | Polls per minute with 5 children | Reference mix (476/min) | Connecting burst (1500/min) |
| --- | --- | --- | --- |
| 50 ms | 6000 | about 8% of the pool | about 25% of the pool |
| 200 ms | 1500 | about 32% of the pool | the pool is full for that short window |

The burst is the constraint. It lasts until ICE settles and Meet drops back to a 4-second poll. A poll that stays under 200 ms fits the reference mix on this profile, including the 10th joiner, as long as that connecting window is brief. A poll slower than 200 ms fills all five children for the whole burst.

Confirm the assumption on the host with the k6 script.

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
