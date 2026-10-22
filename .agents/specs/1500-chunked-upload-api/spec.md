Source: #1500 (body-hash: 446046fa)
Goal: #1498

# API: upload limit, checked parts, blob assembly, true content hash, Quota, version check

Technical translation of Task #1500 (API slice of Epic #1499). The issue is the source of truth for every acceptance criterion; this file records how the API meets it and settles the points the issue leaves to the spec.

## Goal

Drive uploads work on small shared hosts (low `post_max_size`, ~30 s `max_execution_time`, no cron) for files up to `maxSizeBlobSet` (default 4 GB): parts are streamed and checked, assembled in bounded steps by a WGW JMAP extension on top of RFC 9404, attached to a FileNode by a move where safe, downloaded back by stream with `Range`, and versioned by a content hash that always means the true sha256 of the bytes.

## Non-goals

Copied from #1500: guest uploads (#1518), any upload protocol beyond the assembly extension, `Blob/lookup`, digests, `data*` in `Blob/get`, per-user or per-tenant quotas and a soft limit, collab external writes on the JMAP path (#1517). Client and UI work lives in #1501, #1519, #1520, #1502, #1521, #1522.

## Affected packages

- `packages/api` (app, config, migrations, routes, OpenAPI, docs, tests)
- `packages/api/scripts/greenfield-guard.php` (one exempt path for the local-disk primitives)
- `tools/file-size-baseline.tsv` (lower `DriveService.php` after the download helper moves out)

## Settled decisions (points #1500 leaves to the spec)

### Header names for declared part length and sha256

`POST /jmap/upload/{accountId}` accepts two optional request headers:

| Header | Value |
|--------|-------|
| `Wgw-Part-Length` | decimal byte count of the part |
| `Wgw-Part-Sha256` | 64 lowercase hex characters |

Each header that is present is checked against the bytes the server stored. A mismatch deletes the stored bytes and answers `400` with `application/problem+json` and `type: "https://wegotworkspace.org/jmap/problem/part-mismatch"`, `mismatch: ["length"|"sha256", …]`, plus `expectedLength`/`receivedLength` or `expectedSha256`/`receivedSha256`. Uploads without the headers (whole-file uploads, #1501) keep working.

An optional third header `Wgw-Assembly-Id` records the part as claimed by that open assembly (see "Shared parts").

### Blob assembly method names

Capability `https://wegotworkspace.org/jmap/blob-assembly`. Methods:

| Method | Purpose |
|--------|---------|
| `BlobAssembly/set` | `create` (`{size, type?}`) and `destroy` (abandon). No `update`. |
| `BlobAssembly/append` | `{accountId, id, parts: [{index, blobId}]}` — append parts in order |
| `BlobAssembly/finish` | `{accountId, id}` — terminal, safe to repeat |
| `BlobAssembly/get` | standard `/get`: `id`, `size`, `type`, `received`, `nextIndex`, `acceptedParts`, `hashRebuildPending`, `status` (`open` / `finished`), `blobId`, `expires` |

Append response: `{accountId, id, accepted: [index…], rebuiltOnly: bool, hashRebuildPending: bool, received, nextIndex, expires}`. `accepted` lists every index of the request that is now part of the assembly, including indexes accepted earlier (a retried append is a no-op that still reports them). `rebuiltOnly` is true when the call spent its whole budget on a hash rebuild and accepted no new part.

Append errors: an assembly that is unknown, expired, or finished → method error `invalidArguments` whose description says which; an index above `nextIndex` → `invalidArguments`; an index already accepted with a different `blobId` → `invalidArguments`; missing parts → method error `blobNotFound` with `notFound: [blobId…]` (nothing appended past the first missing part); parts whose total size exceeds `stepBudgetBytes` → method error `requestTooLarge` before anything is read; a concurrent call on the same assembly → `serverUnavailable` (retry). Running out of disk → HTTP `507` problem for the whole request.

Finish response: `{accountId, id, blobId: Id|null, size, type, hashRebuildPending}`. `blobId` is null only while a hash rebuild still has steps left; the client repeats `finish`. `received ≠ size` → `invalidArguments`.

Account capability object: `{maxSizeAssembly, stepBudgetBytes, assemblyTtlSeconds}`. Session capability: `{}`.

### Hash-pending FileNode property name

`contentHashPending: Boolean`, only on FileNode objects returned to a request whose `using` contains `https://wegotworkspace.org/jmap/filenode-version-check`. True while the node's true sha256 is not yet known and its `blobId` carries a provisional version.

### `maxDataSources` ceiling

`maxDataSources = min(1024, max(64, max(1, floor(stepBudgetBytes / maxSizeUpload))))`. It never depends on `maxSizeBlobSet`, so `maxSizeBlobSet: null` changes nothing. The ceiling of 1024 bounds per-call bookkeeping (one blob lookup per source); a `maxSizeUpload` of 0 counts as 1.

### `data*` behaviour of `Blob/get`

The smallest conformant option: `Blob/get` serves `id` and `size` only. A `properties` list that names `data`, `data:asText`, `data:asBase64`, `digest:*`, `isEncodingProblem`, or `isTruncated` fails the call with `invalidArguments` naming the property and pointing at `downloadUrl`. RFC 9404 defaults an omitted `properties` to `data` and `size`; this server answers an omitted list with `["id", "size"]`. Both are documented deviations (non-goal "`data*` in `Blob/get`"). `supportedDigestAlgorithms: []`.

### Step budget

`stepBudgetBytes = floor(timeLimit × share × throughput)` where `timeLimit` is `max_execution_time` (0 or unset → 60 s), `share` is `WGW_JMAP_STEP_TIME_SHARE` (default 0.5), and `throughput` is `WGW_JMAP_STEP_THROUGHPUT_BYTES` (default 8 MiB/s). At 30 s this is 120 MiB. The same budget bounds `Blob/upload`, every assembly append and finish step, hash rebuilds, staged copies, and discovered-file hashing.

## Technical constraints

- **Upload limit:** `maxSizeUpload = min(WGW_JMAP_MAX_SIZE_UPLOAD, post_max_size)`; a `post_max_size` of 0 or unparseable is ignored. `upload_max_filesize` is not read.
- **Streaming parts:** `/jmap/upload` reads `$request->getContent(true)` (a stream), never the string. A read filter (`HashingStreamFilter`) hashes and counts bytes while Flysystem writes them to a temporary key on `wgw_data`; the part is then renamed to its content-addressed key. Over `maxSizeUpload` (declared `Content-Length` up front, or counted) → `400` RFC 8620 `limit` problem. The front-controller `413 {error, code: "post_too_large"}` stays.
- **Discarded body:** an empty stored body is never kept when `WgwOversizedPost::emptyBodyLooksDiscarded()` or `phpWarnedPostTooLarge()` is true, or when `Wgw-Part-Length` declares more than 0 bytes; the answer is the `limit` problem.
- **Raw local-disk access** (append, truncate, same-volume rename across disks) lives in `app/Storage/Local/LocalDiskFiles.php`, the one path the greenfield guard exempts for raw PHP file functions. Every caller checks `LocalDiskFiles::isLocal()` and falls back to Flysystem streams for a non-local disk.
- **`HashContext` state:** stored as `base64(serialize($ctx))` with a build tag `PHP_VERSION|php_uname('m')|PHP_INT_SIZE`. Read back only with `unserialize($raw, ['allowed_classes' => [\HashContext::class]])` inside an error-suppressing handler, then `instanceof \HashContext`; a different build tag is not read at all. Any failure → hash rebuild (stream bytes `[hashedBytes, received)` in budgeted steps, saving a fresh state after each step). The assembly is never discarded for a bad state.
- **Assembly file:** `wgw_data:jmap/assemblies/{user}/{id}`. Before an append, a file longer than `received` (a step interrupted after the write) is truncated back to `received`. A lease column (`locked_until`) taken with one conditional `UPDATE` serializes calls on one assembly; it never holds a database transaction open during I/O.
- **Finish:** the final hex is stored (`final_sha256`) before the file is moved to `jmap/blobs/{user}/jb-{sha40}` and the `jmap_blobs` row is written; a retried finish reuses the stored hash. A finalized `HashContext` is never touched again.
- **Shared parts:** a part is deleted after the append that consumed it commits, unless the same `blobId` appears at a later index of the same call or a reference checker vetoes it. Checkers: `BlobAssemblyClaimChecker` (another open assembly claimed the part via `Wgw-Assembly-Id`) and `FileNodeAttachChecker` (an attach copy of the blob is in progress). Both are also the GC's `CHECKERS`.
- **Content hash chokepoint:** `FileNodeIndexService::recordContentWrite($key, $sha256)` requires a hash for files; `null` keeps the stored value instead of nulling it. DAV PUT hashes through a read filter attached in `beforeWriteContent` / `beforeCreateFile` (after ACL). `recordCreate($key, $sha256 = null)`: a file without a hash is a discovered file (hashed in the walk up to `WGW_JMAP_DISCOVERY_HASH_MAX_BYTES`, default 4 MiB, and at most one step budget of bytes per request; otherwise hash-pending). DAV COPY → `recordCopy($from, $to)` (one bulk `INSERT` of the subtree rows, mapped prefix, carried `size_bytes` / `content_sha256`, no file reads). MKCOL keeps null.
- **Hash-pending nodes:** `jmap_file_nodes.hash_pending` plus a `jmap_content_hash_jobs` row holding the resumable state. Provisional version: first 8 hex of `sha256("{size}:{mtime}")` from the disk at the time of the call. The resolver accepts a provisional id only while it equals the current provisional value of a still-pending node. Storing the true hash bumps `change_seq`. Jobs advance opportunistically and in `wgw:jmap:blobs-gc`.
- **Attach:** `FileNode/set` attaches `jb-` blobs by move (`LocalDiskFiles::moveAcross`) only when this is the last reference in the request, no checker vetoes, both disks are local on one device, and deleting the `jmap_blobs` row inside a `lockForUpdate` transaction succeeded. Otherwise a streamed copy; a copy larger than `stepBudgetBytes` is staged on `wgw_files:.wgw-staging/{user}/…` and that create or update fails with SetError `attachInProgress` (`{copied, size}`); the client repeats the same `FileNode/set` until it succeeds. Note markdown under `.notes` keeps the string path (bounded by `maxSizeUpload`).
- **Downloads:** resolvers return a `BlobContent` (media type plus a stream opener). `RangeResponder` serves `/jmap/download`, ticket downloads, and `GET /files/content`: `Accept-Ranges: bytes`, single `Range` (`a-b`, `a-`, `-n`) → `206` + `Content-Range`, unsatisfiable → `416` + `Content-Range: bytes */size`, multiple ranges → full `200`; `Content-Length` from `fstat` of the opened stream.
- **Download ticket:** `POST /jmap/download-tickets/{accountId}` `{blobId, name, type?}` → `201 {ticketId, url, idleExpires, absoluteExpires}`; `GET /jmap/download-ticket/{secret}/{name}` (no `Authorization`). Secret: 32 bytes from `random_bytes`, base64url; stored as sha256. Bound to username, `blobId`, and the refresh-token family of the issuing session (new `sid` JWT claim). Expiry `min(lastSeen + 30 min, issued + 24 h)`; `lastSeen` moves at request start, every 30 s while streaming, and at stream end. Each request re-checks: ticket live, session family live, user enabled, blob resolvable with `mayRead`. A token without `sid` cannot issue a ticket (`403 session_required`).
- **Quota:** `urn:ietf:params:jmap:quota`; one `octets` quota per writable root (`users/{u}` and each group root with `mayAddChildren`), id `dq-{rootNodeId}`. `used` = indexed `SUM(size_bytes)` over live file rows under the root (`LIKE ? ESCAPE '!'`). `hardLimit = used + free` from `DriveFreeSpaceSource` (`disk_free_space` of the `wgw_files` root); `null` free → no quotas. State is an encoded map of `quotaId → fingerprint(used, hardLimit, name)`, so `Quota/changes` is exact without storage; an undecodable state → `cannotCalculateChanges`. `Quota/queryChanges` → `cannotCalculateChanges`.
- **Storage full:** `StorageFullException` (from `ENOSPC` / `EDQUOT` messages or a short write) → `507` problem `type: "https://wegotworkspace.org/jmap/problem/insufficient-storage"` for `/jmap/upload` and for any `/jmap` request whose assembly step hit it; `FileNode/set` → SetError `overQuota`; `Blob/upload` and `BlobAssembly/set` create pre-check free space for the bytes they will add → SetError `overQuota`.
- **Version check:** capability `https://wegotworkspace.org/jmap/filenode-version-check` (methodless provider). The dispatcher hands `using` to methods through `JmapRequestContext`. `FileNodeSetService` computes the allowed update keys per request: `expectedBlobId` only when the capability is in `using`. Mismatch, or any `expectedBlobId` on a hash-pending node → SetError `versionMismatch` with `existingId` and `existingBlobId`, checked before any change to that node.
- **Cleanup:** `JmapBlobMaintenance::runBounded()` runs on a share of `/jmap/upload` and `Blob/upload` requests (`WGW_JMAP_MAINTENANCE_SHARE`, default 0.05) and fully in `wgw:jmap:blobs-gc`: expired blobs (checkers honoured), expired assemblies (file and claims removed), expired tickets, stale staged copies, and one budget of pending content hashes.
- **Files over 800 lines:** none. `FileNodeSetService` and `FileNodeIndexService` hand new logic to new classes; `DriveService` shrinks and its baseline integer is lowered.

## Edge cases

- Zero-byte part with `Content-Length: 0` and no discard signal → valid empty blob
- A single-part assembly and a `Blob/upload` with one full source both yield the part's own `jb-` id; deleting the part never deletes the result because the result is written after the part is consumed
- Two parts with identical bytes in one append call share one `blobId`; the file is kept until the last index of the call is appended
- A retried finish after a time-out between storing `final_sha256` and the blob row reuses the hash
- A hash-pending file rewritten out of band during its hash job: the job restarts from 0 when size or mtime changed
- A ticket idle past 30 minutes while a response is still streaming does not expire (the stream keeps touching `lastSeen`)
- `disk_free_space()` returns `false` → `Quota/get` lists nothing and no free-space pre-check refuses a write
