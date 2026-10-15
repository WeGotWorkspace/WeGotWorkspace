# Spike 3 — persistence

The collaboration save is a framed octet-stream: `[uint16 header length][JSON header][document bytes][Yjs bytes]`. The header is `{ "documentLen", "yjsLen" }`. `null` means that part is absent and `0` means it is present and empty. The number-array body and the temporary base64 body are not accepted. `SAVE_DELAY_MS` is still 2000. `MAX_YJS_BYTES` is still 5,242,880. `MAX_MARKDOWN_BYTES` is still 2,097,152. Fetch (`?format=yjs`) is unchanged.

The tables below are three encodings of the same fixtures, measured on this machine (PHP 8.3.6, no reverse proxy). Number-array and base64 were measured while `decodeYjsBytes` still rebuilt the state. Raw bytes were measured after that path was removed. Symbols at the start of the measurement, on `origin/main` at `988481923`: `saveDocument` sent `yjs: Array.from(Y.encodeStateAsUpdate(ydoc))`, and `decodeYjsBytes` walked that array with `chr()`.

| | Number array | Base64 | Raw bytes |
|---|---|---|---|
| Body at a 5 MiB state | 16.2 MB | 6.99 MB | 5.24 MB |
| Wall at the 4.4 MB state | 3,259 ms | 172 ms | 44 ms |
| Peak memory | 153 MiB | 25 MiB | 16.5 MiB |
| First ceiling, tight | `post_max_size` at 3.50 MB | 5 MB cap | 5 MB cap |
| Sustained 30 × 2 s, tight | — | 30/30, p95 192 ms | 30/30, p95 75 ms |

The 5.24 MB raw body is the 5,242,881-byte state plus the 2,048-byte markdown fixture (5,244,968 bytes on the wire). Base64 of that state was 6,992,581 bytes. The 4.4 MB state is the 12,000-row fixture (4,382,159 bytes); raw wall is the median of five saves (tight 43.9 ms, roomy 44.1 ms) and the peak is 17,354,752 bytes. Raw is about four times faster than base64 here, not the same. Base64 had already removed the `chr()` loop; it still paid for `json_decode` of a multi-megabyte JSON document and for `base64_decode`. The raw frame skips both. Peak drops from 25 MiB to 16.5 MiB for the same reason. The reason to ship raw bytes rather than base64 is still the margin below, and the speed is a second, larger, gain.

Worst case that base64 does not have room for, now measured. Yjs is exactly `MAX_YJS_BYTES` (5,242,880) and the document is 1,200,000 bytes of CSV with quotes. The framed body is 6,442,922 bytes. `post_max_size` 8M is 8,388,608 bytes, so the margin is 1,945,686 bytes (23%). The tight host accepted it: 200, median 55.7 ms, peak 22.2 MiB (23,236,608). The roomy host matched (median 56.8 ms, same peak).

| Form | Yjs 5 MiB becomes | File of ~12,000 rows | Total body | Margin on 8 MiB |
|---|---|---|---|---|
| Number array | ~16.2 MB | ~1.3 MB | ~17.5 MB | well over |
| Base64 | 6.99 MB | ~1.3 MB | ~8.29 MB | ~1% |
| Raw bytes | 5.24 MB | 1.2 MB | 6.44 MB | 23% |

Four numbers from the earlier two encodings:

| Host | Body | First ceiling |
|---|---|---|
| Tight | number array | `post_max_size` at 9,600 rows (3.50 MB state). Last save that lands: 4,800 rows, 1,287 ms. |
| Roomy | number array | 2,000 ms between 4,800 rows (1,289 ms) and 9,600 rows (2,611 ms), about 7,400 rows and 2.7 MB. |
| Tight | base64 | 12,000 rows in 172 ms. The 5 MB cap is first (14,400 rows, 413 `yjs_too_large`). |
| Roomy | base64 | Same: 172 ms at 12,000 rows, then the 5 MB cap. |

## Configurations

PHP 8.3.6, same machine, PHP built-in server, `PHP_CLI_SERVER_WORKERS=4`. No reverse proxy, so there is no nginx `client_max_body_size`. `opcache.enable` is On. `opcache.enable_cli` is Off in the CLI default; both servers were started with `-d opcache.enable_cli=1`.

| | Tight | Roomy |
|---|---|---|
| `post_max_size` | 8M | 64M |
| `upload_max_filesize` | 8M | 64M |
| `memory_limit` | 128M | 512M |
| `max_execution_time` | 30 | 120 |
| Bind | 127.0.0.1:9082 | 127.0.0.1:9083 |

## Fixtures

`buildLargeFile` from the YCSV prototype, seed `mulberry32(20261013)`, absolute formulas. Row ids and the Yjs client id are fixed (`clientID = 1`) so the bytes repeat. Markdown is a constant 2,048 bytes. The earlier 498 KB anchor at 1,200 rows included a random Yjs client id; this run is 426,089 bytes.

| State | Rows | State bytes | JSON array body | Expansion | Base64 body | Expansion |
|---|---|---|---|---|---|---|
| 0.5 MB | 1,200 | 426,089 | 1,317,165 | 3.09× | 570,193 | 1.34× |
| 1 MB | 2,400 | 863,807 | 2,668,574 | 3.09× | 1,153,817 | 1.34× |
| 2 MB | 4,800 | 1,742,865 | 5,378,317 | 3.09× | 2,325,893 | 1.33× |
| 4 MB | 9,600 | 3,501,039 | 10,798,030 | 3.08× | 4,670,125 | 1.33× |
| 5 MB | 12,000 | 4,382,159 | 13,514,618 | 3.08× | 5,844,953 | 1.33× |
| 6 MB | 14,400 | 5,263,763 | 16,242,016 | 3.09× | 7,020,425 | 1.33× |
| 5 MB + 1 | 9,600, padded | 5,242,881 | 17,765,372 | 3.39× | 6,992,581 | 1.33× |

The 3.3× estimate lands at 3.09×. Base64 lands at 1.33×.

## M1–M3 — single save

Five tries, median. Peak is `memory_get_peak_usage(true)` after `memory_reset_peak_usage()` at the start of `updateCollaboration`, logged only when `WGW_SPIKE_PEAK=1`.

### Tight

| State | Status | Wall (median) | Peak | First limit |
|---|---|---|---|---|
| 0.5 MB | 200 | 333.5 ms | 14.0 MiB | — |
| 1 MB | 200 | 645.8 ms | 22.6 MiB | — |
| 2 MB | 200 | 1,286.9 ms | 43.1 MiB | — |
| 4 MB | 413 `post_too_large` | 11.5 ms | — | `post_max_size` |
| 5 MB | 413 `post_too_large` | 13.1 ms | — | `post_max_size` |
| 6 MB | 413 `post_too_large` | 14.2 ms | — | `post_max_size` |
| 5 MB + 1 | 413 `post_too_large` | 18.5 ms | — | `post_max_size` |

### Roomy

| State | Status | Wall (median) | Peak | First limit |
|---|---|---|---|---|
| 0.5 MB | 200 | 330.9 ms | 14.0 MiB | — |
| 1 MB | 200 | 649.1 ms | 22.6 MiB | — |
| 2 MB | 200 | 1,289.3 ms | 43.1 MiB | — |
| 4 MB | 200 | 2,611 ms | 85.0 MiB | 2,000 ms wall |
| 5 MB | 200 | 3,258.8 ms | 153.3 MiB | 2,000 ms wall |
| 6 MB | 413 `yjs_too_large` | 3,853.6 ms | 155.5 MiB | `MAX_YJS_BYTES` after the decode |
| 5 MB + 1 | 413 `yjs_too_large` | 3,993.1 ms | — | `MAX_YJS_BYTES` |

The 6 MB peak is one later sample on the roomy server after the log was moved into a `finally`. The five-try median above did not record it. `memory_limit`, `max_execution_time`, and the 64M `post_max_size` were not hit.

**Through 2,000 ms at:** tight, not reached before `post_max_size` (last success 4,800 rows / 1.74 MB / 1,287 ms). Roomy, between 4,800 and 9,600 rows. The doubling is almost exact, so 2,000 ms sits near 7,400 rows and 2.7 MB of state.

## M4 — sustained save (30 × 2 s)

One writer. Starts every 2 seconds, without waiting for the previous response. Bytes are what the client sent, including bodies the server refused.

| State | Config | Succeeded | p95 | Climb? | Bytes sent |
|---|---|---|---|---|---|
| 1 MB | tight | 30/30 | 660.5 ms | no | 80.1 MB |
| 2 MB | tight | 30/30 | 1,306.1 ms | no | 161.3 MB |
| 4 MB | tight | 0/30 | 16.1 ms | no | 323.9 MB (`post_too_large`) |
| 5 MB | tight | 0/30 | 16.7 ms | no | 405.4 MB (`post_too_large`) |
| 1 MB | roomy | 30/30 | 659.3 ms | no | 80.1 MB |
| 2 MB | roomy | 30/30 | 1,312.7 ms | no | 161.3 MB |
| 4 MB | roomy | 30/30 | 2,647.1 ms | no | 323.9 MB |
| 5 MB | roomy | 30/30 | 3,427.9 ms | no | 405.4 MB |

1 MB on the roomy host did not collapse. Wall time did not climb, including at 5 MB where one save takes 3.3 s. The decode runs before `acquireDocumentLock`, and the etag is a hash of the bytes. The same fixture keeps the same etag, so a second in-flight save still matches.

### M4b — several writers

Same document, same fixture. The 1-writer rows from this phase are discarded: that path already had a sidecar from M4, so `If-None-Match: *` returned 412 for all 30. One writer is the M4 table. Three and five writers were primed on a fresh path.

| State | Config | Writers | Succeeded | p95 | Climb? | Bytes sent | Lock wait max |
|---|---|---|---|---|---|---|---|
| 1 MB | roomy | 3 | 90/90 | 1,348.7 ms | no | 240.2 MB | 28.6 ms |
| 1 MB | roomy | 5 | 150/150 | 1,970.2 ms | no | 400.3 MB | 26.7 ms |
| 2 MB | roomy | 3 | 90/90 | 2,614.4 ms | no | 484.0 MB | 28.7 ms |
| 2 MB | roomy | 5 | 150/150 | 5,317.7 ms | yes | 806.7 MB | 26.7 ms |
| 1 MB | tight | 3 | 90/90 | 1,920.4 ms | no | 240.2 MB | 26.1 ms |
| 1 MB | tight | 5 | 150/150 | 1,946.4 ms | no | 400.3 MB | 39.5 ms |
| 2 MB | tight | 3 | 90/90 | 2,616.3 ms | no | 484.0 MB | 33.9 ms |
| 2 MB | tight | 5 | 150/150 | 4,131.5 ms | no | 806.7 MB | 18.2 ms |

Etag refusals on these rows: 0. The lock waited at most about 40 ms. Five writers of the 2 MB state on the roomy host did climb (first-10 median 1,623 ms, last-10 median 2,613 ms) and the p95 went to 5.3 s. That is worker queueing during the decode, not the flock.

## M5–M6 — base64 body

`decodeYjsBytes` accepts a base64 string and still accepts the number array. The array client is unchanged.

### Tight

| State | Status | Wall (median) | Peak | First limit |
|---|---|---|---|---|
| 0.5 MB | 200 | 35.6 ms | 6.0 MiB | — |
| 1 MB | 200 | 51.2 ms | 8.0 MiB | — |
| 2 MB | 200 | 77.8 ms | 12.7 MiB | — |
| 4 MB | 200 | 139.3 ms | 22.7 MiB | — |
| 5 MB | 200 | 172.3 ms | 24.9 MiB | — |
| 6 MB | 413 `yjs_too_large` | 173.9 ms | 24.1 MiB | `MAX_YJS_BYTES` |
| 5 MB + 1 | 413 `yjs_too_large` | 172.4 ms | 24.0 MiB | `MAX_YJS_BYTES` |

### Roomy

| State | Status | Wall (median) | Peak | First limit |
|---|---|---|---|---|
| 0.5 MB | 200 | 38.3 ms | 8.0 MiB | — |
| 1 MB | 200 | 49.9 ms | 8.0 MiB | — |
| 2 MB | 200 | 80.8 ms | 12.7 MiB | — |
| 4 MB | 200 | 140.4 ms | 20.7 MiB | — |
| 5 MB | 200 | 171.8 ms | 24.9 MiB | — |
| 6 MB | 413 `yjs_too_large` | 173.0 ms | 24.1 MiB | `MAX_YJS_BYTES` |
| 5 MB + 1 | 413 `yjs_too_large` | 172.3 ms | 24.0 MiB | `MAX_YJS_BYTES` |

**Through 2,000 ms at:** neither config. 12,000 rows is 172 ms. The next fixture is over `MAX_YJS_BYTES`.

### Sustained base64 (30 × 2 s)

| State | Config | Succeeded | p95 | Climb? | Bytes sent |
|---|---|---|---|---|---|
| 1 MB | tight | 30/30 | 62.4 ms | no | 34.6 MB |
| 2 MB | tight | 30/30 | 93.8 ms | no | 69.8 MB |
| 4 MB | tight | 30/30 | 159.9 ms | no | 140.1 MB |
| 5 MB | tight | 30/30 | 191.8 ms | no | 175.3 MB |
| 1 MB | roomy | 30/30 | 61.6 ms | no | 34.6 MB |
| 2 MB | roomy | 30/30 | 96.0 ms | no | 69.8 MB |
| 4 MB | roomy | 30/30 | 158.7 ms | no | 140.1 MB |
| 5 MB | roomy | 30/30 | 198.6 ms | no | 175.3 MB |

## Which limit is hit first

On the tight host with a number array, `post_max_size` (8M) is first. The 9,600-row body is 10.8 MB and returns 413 `post_too_large` in about 12 ms. The 5 MB + 1 byte state never reaches `MAX_YJS_BYTES` on that path. On the roomy host the same array gets in. Wall time crosses 2,000 ms between 4,800 and 9,600 rows, while peak memory is 85 MiB of a 512M limit and the request finishes in 2.6 s of a 120 s limit. `MAX_YJS_BYTES` answers after the decode, at 5,242,881 bytes, with 413 `yjs_too_large` and about 3.9 s already spent. With a base64 body the 8M post limit no longer binds: 5 MB + 1 byte is a 7.0 MB body, and both hosts return 413 `yjs_too_large` in about 172 ms.

## Is binary enough, or is incremental required

Base64 moves the tight ceiling from 4,800 rows to the app's own 5 MB cap, past 12,000 rows, and the sustained save holds on the tight host (30/30, p95 192 ms, no climb). For the PHP limits, base64 is enough for now. The upload does not shrink to a small number: one writer at 12,000 rows still sends 175 MB in that minute. Five writers of the 2 MB number-array state sent 807 MB in the same minute. Incremental save is not what keeps this host from falling over once the body is base64. It is what cuts that upload.

Raw bytes, measured after this note, keep that ceiling and land the 1.2 MB file beside a full 5 MiB state (6.44 MB body, 23% under 8 MiB). Base64's worst case was about 8.29 MB, inside about 1%. The save path ships the raw frame. Incremental save is still the upload cut, and it is not in this change.

## What the save interval should be

`SAVE_DELAY_MS` stays 2,000 ms. With base64, a 12,000-row save returns in about 190 ms, so the queue does not start the next save while the previous one is still running. The interval is that short because an unpinned document has no local durability and the server is the safety net. Widening it without a local write trades bandwidth for lost edits. A chosen writer per document is not required to stop etag waste on identical states: the etag is a content hash, so the same fixture never 412s, and the lock waited under 40 ms. Five writers still multiply the upload, and on the number-array path their p95 climbed to 5.3 s.

## Raw bytes

Same fixtures, same two servers, `Content-Type: application/octet-stream`. Five tries, median. The document half of these rows is still the 2,048-byte markdown fixture, so the body is the state plus that file plus a 38-byte header (`{"documentLen":2048,"yjsLen":…}`).

| State | State bytes | Raw body | Tight | Roomy |
|---|---|---|---|---|
| 0.5 MB | 426,089 | 428,175 | 200, 25.1 ms, 4.0 MiB | 200, 26.9 ms, 4.0 MiB |
| 1 MB | 863,807 | 865,893 | 200, 26.4 ms, 6.0 MiB | 200, 27.6 ms, 6.0 MiB |
| 2 MB | 1,742,865 | 1,744,952 | 200, 31.2 ms, 8.0 MiB | 200, 29.8 ms, 8.0 MiB |
| 4 MB | 3,501,039 | 3,503,126 | 200, 39.3 ms, 14.0 MiB | 200, 40.5 ms, 14.0 MiB |
| 4.4 MB | 4,382,159 | 4,384,246 | 200, 43.9 ms, 16.5 MiB | 200, 44.1 ms, 16.5 MiB |
| 6 MB | 5,263,763 | 5,265,850 | 413 `yjs_too_large`, 25.4 ms | 413 `yjs_too_large`, 25.2 ms |
| 5 MB + 1 | 5,242,881 | 5,244,968 | 413 `yjs_too_large`, 24.9 ms | 413 `yjs_too_large`, 25.4 ms |
| Cap + 1.2 MB CSV | 5,242,880 | 6,442,922 | 200, 55.7 ms, 22.2 MiB | 200, 56.8 ms, 22.2 MiB |

The first tight ceiling is `MAX_YJS_BYTES`. The 3.50 MB state that the number array lost to `post_max_size` lands. The 6.44 MB worst case lands on the 8M host.

Sustained, one writer, 30 saves of the 4.4 MB state starting every 2 s on the tight host: 30/30, p95 74.7 ms, median 64.1 ms, no climb (first-10 median 60.5 ms, last-10 median 67.2 ms). Bytes sent 131.5 MB.

## Deviations

- The 5 MB + 1 fixture is the 9,600-row sheet plus pad. Yjs skipped the exact length 5,242,881, so one trailing zero byte was appended. The stored length is exact.
- 14,400 rows encode to 5,263,763 bytes, just over the cap, not a round 6 MB.
- Peak for the roomy number-array 413s was not in the five-try log. One later 6 MB sample peaked at 155.5 MiB.
- M4b's 1-writer paths collided with M4 and are omitted.
- `WGW_SPIKE_PEAK=1` logs peak memory and lock wait. It is off unless set.
