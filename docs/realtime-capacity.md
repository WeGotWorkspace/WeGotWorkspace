# Real-time capacity on shared hosting

Reference profile: PHP-FPM with `pm.max_children = 5`. One child serves one request. The admin page **Real-time health** (`/admin/realtime-health`) reads the same instance. It does not call a third party.

Clients poll their own signaling route. After a room is connected the cadence backs off (`packages/apps/src/lib/rtc/session/poll-cadence.ts`):

| Channel | While connecting | Once the room is stable |
| --- | --- | --- |
| Meet | 400 ms | 4 s |
| Docs | 400 ms | 15 s |
| Presence | 400 ms | 1.2 s (no extra backoff) |

Session samples (`POST /rtc/metrics`) are at most one request a minute per session, so they do not change this budget.

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

Confirm the assumption on the host with the k6 script. The health page then shows whether that host is actually spending its connects on relay or HTTP fallback.
