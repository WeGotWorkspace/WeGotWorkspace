# Real-time capacity on shared hosting

Reference profile: PHP-FPM with `pm.max_children = 5`. One child serves one request. The instance does not call a third party for real-time traffic.

Clients poll their own signaling route. After a room is connected the cadence backs off (`packages/apps/src/lib/rtc/session/poll-cadence.ts`):

| Channel | While connecting | Once the room is stable |
| --- | --- | --- |
| Meet | 400 ms | 4 s |
| Docs | 400 ms | 15 s |
| Presence | 400 ms | 1.2 s (no extra backoff) |

Clients do not post session samples. The budget below is signaling polls only.

## Scenario

`tools/load/rtc-shared-hosting.k6.js` drives that mix over HTTP:

- N presence peers on `p_workspace` (default N = 8)
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

```bash
k6 run -e BASE_URL=https://example.test -e PUSH_USER=… -e PUSH_PASSWORD=… tools/load/rtc-shared-hosting.k6.js
```

All browsers in the scenario share one account, so the per-account ceiling caps it at about 15 browsers at a 3-second retry (300 a minute). More browsers need more accounts.

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

**Still to do:** run the push scenario on a host with `pm.max_children = 5`, MySQL and a realistic data set, and record push p95, write p95 and busy children here.
