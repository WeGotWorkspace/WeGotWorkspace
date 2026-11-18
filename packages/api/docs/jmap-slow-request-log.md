# Slow JMAP request log

A `POST /api/v1/jmap` or `POST /api/v1/jmap/upload/{accountId}` call (and the guest variants) that takes longer than `WGW_SLOW_REQUEST_LOG_MS` (default 2000 ms; `0` turns it off) writes one `jmap.slow_request` line at `info` level to the app log after its response went out (#2244). It answers "which JMAP method was slow, and was it waiting on the database or on storage?", which the web server's access log cannot.

| Field | Meaning |
|---|---|
| `route` | Route pattern, e.g. `api/v1/jmap/upload/{accountId}`. Never the path, so no account name. |
| `status` | HTTP status. |
| `request_bytes` | `Content-Length` of the request, when sent. |
| `ms` | Whole request, from PHP's request start until the log is written. |
| `db_ms`, `db_queries` | Time and count of database queries, plus `COMMIT`s. |
| `db_commit_ms` | The `COMMIT` share of `db_ms` (where a Galera cluster certifies writes). |
| `storage_ms`, `storage_ops` | Operations on the `wgw_data`, `wgw_files` and `wgw_notes` disks, and the raw appends, truncates and renames of `LocalDiskFiles`. Hashing during an append is not counted. |
| `other_ms` | `ms − db_ms − storage_ms`: PHP work, hashing, reading a stream opened from a disk, network calls such as IMAP. |
| `methods` | One `{name, ms, db_ms, storage_ms}` per JMAP method call, in order. Only registered method names; never arguments, ids or results. |

How it works: `RequestTimings` (one per request) collects the times. `RequestTimingServiceProvider` feeds it from the query and commit events and registers the `wgw_local` disk driver, which is the `local` driver with Flysystem wrapped in `TimedFilesystemAdapter`. `JmapMethodDispatcher` times each method, and the `wgw.slow-log` route middleware writes the line.

Reading it: a high `storage_ms` with low `db_ms` points at the file storage (on a network filesystem, a write waits for the upload of its blocks when the file is closed). A high `db_commit_ms` points at commit or certification waits. A `BlobAssembly/append` or `/finish` call is meant to take up to half of `max_execution_time` (see [files/jmap-blob-assembly.md](files/jmap-blob-assembly.md#limits)); it is slow when it takes longer than that.
