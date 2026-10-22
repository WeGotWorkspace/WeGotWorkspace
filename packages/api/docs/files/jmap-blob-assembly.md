# Chunked uploads, blob assembly, content hash, and the version check

> **Issue:** #1500 (API slice of Epic #1499) · **Spec:** `.agents/specs/1500-chunked-upload-api/spec.md` · **Related:** [jmap-quota.md](jmap-quota.md), [jmap-filenode-design.md](jmap-filenode-design.md)

Drive uploads must work on small shared hosts: a low `post_max_size`, a `max_execution_time` of about 30 s, and no cron. Large files (default limit 4 GB) are uploaded in parts, assembled in bounded steps, attached to a FileNode by a move where safe, and downloaded back by stream with HTTP `Range`. This page documents the server contracts and every deviation from the RFCs.

## Limits

| Value | Where | Derivation |
|-------|-------|------------|
| `maxSizeUpload` | core capability | the smaller of `WGW_JMAP_MAX_SIZE_UPLOAD` and `post_max_size` (0 or unparseable ignored). `upload_max_filesize` is not used: it applies to multipart file uploads, and `/jmap/upload` takes a raw body. Limits PHP cannot see (nginx `client_max_body_size`, Apache `LimitRequestBody`, a proxy) are handled by the client adapting its part size (#1519). |
| `stepBudgetBytes` | blob-assembly capability | `max_execution_time` (0 → `WGW_JMAP_STEP_UNLIMITED_SECONDS`, 60) × `WGW_JMAP_STEP_TIME_SHARE` (0.5) × `WGW_JMAP_STEP_THROUGHPUT_BYTES` (8 MiB/s); at least 1 MiB. 120 MiB at 30 s. Bounds every `Blob/upload`, assembly append and finish, hash rebuild, staged copy, and discovered-file hashing. |
| `maxSizeBlobSet` | blob capability | `WGW_JMAP_MAX_SIZE_BLOB_SET`, default 4 GB; `null` (empty or `"null"`) for no limit |
| `maxDataSources` | blob capability | `min(1024, max(64, max(1, floor(stepBudgetBytes / maxSizeUpload))))` |

`maxDataSources` deviation: RFC 9404 requires at least 64. Where the step budget cannot cover 64 parts, the server still advertises 64 and refuses up front what one call cannot do (below). The 1024 ceiling bounds per-call bookkeeping and does not depend on `maxSizeBlobSet`.

## `POST /jmap/upload/{accountId}`

The body is streamed to storage and hashed incrementally (a read filter on the request stream while Flysystem writes it), so `memory_limit` never bounds the size of a part. Each part's sha256 is stored with it. `jb-` ids are the first 40 of 64 hex characters of the sha256; the storage key and the row are per account, the id string is not.

Optional request headers:

| Header | Meaning |
|--------|---------|
| `Wgw-Part-Length` | declared byte count |
| `Wgw-Part-Sha256` | declared sha256, 64 hex characters |
| `Wgw-Assembly-Id` | the open assembly this part is for (a claim, see Cleanup) |

Responses that mean "too large" — the client treats both alike:

| Status | Body | When |
|--------|------|------|
| 413 | `{error, code: "post_too_large"}` | `public/index.php` (`WgwOversizedPost::abortIfExceeded()`), before Laravel: declared `Content-Length` over `post_max_size` |
| 400 | problem `urn:ietf:params:jmap:error:limit`, `limit: "maxSizeUpload"` | over `maxSizeUpload` (declared or counted), or a body PHP discarded |

PHP empties an oversized POST body, and the front controller only sees it through `Content-Length`. The controller therefore treats an empty body as discarded when `emptyBodyLooksDiscarded()` or `phpWarnedPostTooLarge()` is true, or when `Content-Length` / `Wgw-Part-Length` declared more than 0 bytes. A discarded body is never stored as an empty part.

A part whose stored length or sha256 differs from a declared one is deleted and answered with `400` problem `https://wegotworkspace.org/jmap/problem/part-mismatch` (`mismatch: ["length", "sha256"]`, `expectedLength` / `receivedLength`, `expectedSha256` / `receivedSha256`). A full disk or hosting quota is `507` problem `https://wegotworkspace.org/jmap/problem/insufficient-storage`.

## RFC 9404 (`urn:ietf:params:jmap:blob`)

Session value `{}`; account value `{maxSizeBlobSet, maxDataSources, supportedTypeNames: [], supportedDigestAlgorithms: []}`. No lookups, no digests.

**`Blob/upload`** joins `data` sources into one new blob: `{blobId, offset?, length?}` (streamed from a stored blob), `data:asText`, and `data:asBase64` (bounded by `maxSizeRequest`). The new id and `sha256` are the true sha256 of the joined bytes, computed while joining; each source is read once.

- The total of all sources in the call is checked first: over `stepBudgetBytes` → method error `requestTooLarge` (`limit: "stepBudgetBytes"`) before a byte is written, because hitting `max_execution_time` is a fatal error PHP cannot turn into a JMAP response. Large files use the assembly extension instead.
- An unknown or expired source fails that creation with SetError `blobNotFound` and a `notFound` list of the missing ids (RFC 9404 defines no type; this follows RFC 8621), so the client re-uploads just those.
- More sources than `maxDataSources`, or a result over `maxSizeBlobSet` → `tooLarge`. A range past the end, two source forms in one object, invalid base64 or UTF-8 → `invalidProperties`.
- Free space is checked against the bytes the new blob adds (stored parts are already off the free space) → `overQuota`.

**`Blob/get`** serves `id` and `size` only (non-goal: `data*` and digests). A `properties` list naming `data`, `data:asText`, `data:asBase64`, `digest:*`, `isEncodingProblem`, or `isTruncated` is `invalidArguments`; bytes come from `downloadUrl`. Deviation: an omitted `properties` means `["id", "size"]`, not RFC 9404's default of `data` and `size`. `ids: null` is `invalidArguments`.

## Blob assembly extension (`https://wegotworkspace.org/jmap/blob-assembly`)

RFC 9404 creates a new, immutable blob in one `Blob/upload`, so stepwise assembly cannot happen inside it. This is the one WGW upload extension; the rest stays standard. It is advertised in the Session and only usable when listed in `using`.

Account value: `{maxSizeAssembly, stepBudgetBytes, assemblyTtlSeconds}`.

| Method | Arguments → response |
|--------|----------------------|
| `BlobAssembly/set` | `create: {cid: {size, type?}}` → `created.cid: {id, size, type, expires}`; `destroy: [id]` abandons one. No `update`. `size > maxSizeAssembly` → `tooLarge`; not enough free space → `overQuota`. |
| `BlobAssembly/append` | `{id, parts: [{index, blobId}]}` → `{id, accepted: [index], rebuiltOnly, hashRebuildPending, received, nextIndex, expires}` |
| `BlobAssembly/finish` | `{id}` → `{id, blobId, size, type, hashRebuildPending}` |
| `BlobAssembly/get` | standard `/get` → `id, size, type, received, nextIndex, acceptedParts, hashRebuildPending, status, blobId, expires` |

**Appending.** Parts go in order with consecutive indexes. `accepted` lists every index of the call that is part of the assembly, including ones accepted before: appending an already accepted index is a no-op reported as accepted, so a retried call never glues a part twice (an index already accepted with another `blobId` is `invalidArguments`). The cost of a call is the size of the parts it appends, not the size of the file so far; parts over `stepBudgetBytes` in total → `requestTooLarge` before anything is read. Missing parts → method error `blobNotFound` with `notFound`, nothing appended. A concurrent call on the same assembly → `serverUnavailable` (a lease taken by one conditional `UPDATE`, never a transaction held during I/O). A step interrupted after writing bytes is detected on the next call (file longer than `received`) and truncated back.

**Running hash.** The assembly keeps a running SHA-256, updated while each part is appended. Between calls it is stored as a serialized `HashContext` (documented `__serialize()` / `__unserialize()`; about 300 bytes) together with the build that wrote it (`PHP_VERSION|php_uname('m')|PHP_INT_SIZE`):

- read back only with `unserialize($state, ['allowed_classes' => [HashContext::class]])`, never a bare `unserialize()`, and checked with `instanceof HashContext` — a corrupt value returns `false` with a warning, and `false` never flows onward;
- a state written by another build is not read at all (the format is undocumented internal state, and `wgw upgrade` can run between two steps);
- in every one of those cases the assembly is kept: the server rebuilds the hash by streaming the bytes assembled so far, one step budget per call, storing a fresh state after each step, and then continues. A call that only advanced the rebuild answers `accepted` without new indexes and `rebuiltOnly: true`. The TTL bounds how long a stale state can exist. No request ever reads the whole file.

**Finishing** is terminal and safe to repeat. It checks the total length, finalizes the hash, stores it (`final_sha256`) before committing — a finalized `HashContext` cannot be updated or finalized again (`TypeError`), so a finish retried after a time-out reuses the stored hash — and turns the assembly into one ordinary `jb-` blob whose id is the true sha256. A file uploaded in parts gets the same `fnb-` id as the same file uploaded in one piece. `blobId: null` with `hashRebuildPending: true` means the call spent its budget rebuilding the hash; repeat it.

**TTL.** An assembly has its own TTL (`WGW_JMAP_ASSEMBLY_TTL_HOURS`, 24, renewed by every append). An abandoned assembly expires and releases its parts; it never pins them forever.

## One meaning for `content_sha256`

`content_sha256` is always the true sha256 of the file's bytes. `FileNodeIndexService::recordContentWrite()` is the chokepoint: every WGW write path passes the hash it computed while streaming the write. DAV PUT hashes the body with a read filter attached on `beforeWriteContent` / `beforeCreateFile` (after ACL and preconditions, at a late priority). A missing hash never nulls a stored value: the file is then treated as discovered. DAV COPY inserts the destination rows for the whole subtree in one bulk statement that maps the source `storage_key` prefix onto the destination and carries `size_bytes` and `content_sha256` across, with no file reads (a copied folder is in the index at once). MKCOL keeps null. A byte-identical rewrite keeps its hash, so the `fnb-` id does not change and no device re-downloads the file.

A null hash is only legitimate for directories, legacy rows, and files discovered on disk whose hash is still pending.

**Discovered files** (SFTP, a hosting file manager, a restored backup, rsync) reach the index through `reconcileDirectory()` during a listing or `reindexAll()`. Files up to `WGW_JMAP_DISCOVERY_HASH_MAX_BYTES` (4 MiB, and at most half a step budget per request) are hashed in the walk. Larger ones, and legacy rows, are **hash-pending** (`jmap_file_nodes.hash_pending` plus a `jmap_content_hash_jobs` row) and hashed later in budgeted steps with the same resumable `HashContext` machinery: opportunistically, and by `wgw:jmap:blobs-gc`. A job whose file changed size or mtime starts again from byte 0. `ensureContentSha()` never hashes a large file inside a request.

While a hash is pending, `blobId()` still returns a valid `fnb-{nodeId}-{8 hex}` whose 8 hex characters are the start of `sha256("{size}:{mtime}")` from the disk. It is recognised as provisional by the node's state, never by its format. `FileNodeBlobResolver` accepts it only while it is the node's current provisional value — the same strict comparison as for a content hash — so an id minted before an out-of-band overwrite is a miss. Storing the true hash bumps `change_seq`, so `FileNode/changes` reports the node once per discovered file; WGW clients do not re-download because of it (`needsContentResync` compares times).

**DAV PATCH is not served**: `Sabre\DAV\PartialUpdate\Plugin` is not registered, although `FlysystemFile` implements `IPatchSupport` and older comments say "PUT, PATCH". If the plugin is ever registered, a partial write needs a full streamed re-hash; the hash cannot be derived from the patch bytes.

## Attaching a blob to a FileNode

`FileNode/set` attaches a `jb-` blob by streaming, never through a PHP string (`FileNodeBlobAttacher`). Attaching is a **move** (a rename from `wgw_data` to `wgw_files`) only when all of these hold:

- this is the last reference to that `blobId` in the request (content-addressed blobs can be referenced twice, e.g. two names with the same content);
- no reference checker vetoes it (a part claim, an attach copy in progress);
- both disks are local and on one device;
- the blob row was deleted inside a `lockForUpdate` transaction, so a concurrent request cannot validate the blob and then find its file gone (it gets `invalidProperties` "Unknown blobId" instead).

Every other attach is a **streamed copy** through a staging file under `wgw_files:.wgw-staging/` (a failed copy never truncates the target), with `jmap_blobs.in_use_until` set so a concurrent attach copies too. A copy larger than `stepBudgetBytes` is split across calls: that create or update fails with SetError `attachInProgress` (`copied`, `size`), and the client repeats the same `FileNode/set` until it succeeds. Note markdown under `.notes` keeps the string path (small).

Behaviour change: a blob attached by move is consumed. RFC 8620 lets an unreferenced upload live for an hour; here the next `FileNode/set` that names it gets "Unknown blobId", so a client uploads once per file.

**Accepted peak disk use:** about 1× the file when attaching is a move (parts are deleted as they are appended), about 2× with a copy (different volumes, or a blob that is still referenced).

## Downloads

`/jmap/download`, ticket downloads, and `GET /files/content` stream (`RangeResponder`): `Accept-Ranges: bytes`; a single `Range` (`a-b`, `a-`, `-n`) → `206` with `Content-Range`; unsatisfiable → `416` with `Content-Range: bytes */size`; several ranges → the full `200`. `Content-Length` and the range arithmetic use the size of the opened file at stream time, not `size_bytes`.

**Download ticket.** A native browser download cannot send the `Authorization` header. `POST /jmap/download-tickets/{accountId}` `{blobId, name, type?}` returns a URL `GET /jmap/download-ticket/{secret}/{name}`:

- the secret is 256 bits from `random_bytes()`, stored only as sha256;
- bound to one `blobId`, one account, and the refresh-token family of the issuing session (`sid` claim); ending that session (sign-out, a revoked device, a password change) ends its tickets; a token without `sid` gets `403 session_required`;
- expiry `min(lastSeen + 30 min, issued + 24 h)`; `lastSeen` moves at each request start, about every 30 s while a response streams, and at its end, so probes, retries, and `Range` resumes work and a download that keeps progressing does not expire;
- every request re-resolves the blob for the bound account with the same `mayRead` check as the authenticated route, so a withdrawn share or a disabled account stops a download at its next request.

Accepted exception: for a hash-pending node the id carries a provisional size/mtime version, so an out-of-band rewrite that keeps both (`rsync --times`, `cp -p`, a tar extraction) can be served under the same ticket. Those files are by definition the large ones, so refusing tickets for them is not an option; the effect is limited to a download delivering newer content than the listing showed, and never affects a write (*Replace* is refused on hash-pending nodes).

## Per-file version check (`https://wegotworkspace.org/jmap/filenode-version-check`)

A WGW extension to draft-ietf-jmap-filenode-14, advertised in the Session (`{}`), not part of `urn:ietf:params:jmap:filenode`.

- *Replace* is an update of the existing node's `blobId`, never a create with `onExists: "replace"`: that path destroys the node and creates a new one (`resolveCollision()`), which loses shares and grants, makes every other device drop its offline copy, and breaks references to the node id.
- The update object may carry **`expectedBlobId`**. If the node no longer has that blobId, that one update fails with SetError **`versionMismatch`** (`existingId`, `existingBlobId`) before anything about the node changes; the rest of the request still applies. Without the property, behaviour is unchanged.
- `expectedBlobId` is allowed per request: the set of update keys is computed for each request and includes it only when the capability is in `using`. Without it the key is unknown and the update fails with `invalidProperties` naming it — never accepted and ignored, which would be a plain overwrite.
- On a hash-pending node `expectedBlobId` is always `versionMismatch`: those files were written outside WGW, where size and mtime are a weak version. FileNodes carry `contentHashPending: Boolean` for clients that use the capability, so they do not offer *Replace* for such a file.

Why not the standard tools: `ifInState` is account-wide, and `onExists: "newest"` compares timestamps only (and defaults a missing `modified` to the current time, so without it `newest` behaves like `replace`). The version is the content hash in the `fnb-` id, so A → B → A counts as unchanged; accepted.

## Running out of space

A write that fails for lack of space — including a host refusing it because the account's hosting quota is full (`EDQUOT`), which `disk_free_space()` does not show — is `507` with the insufficient-storage problem for `/jmap/upload` and for any `/jmap` request whose assembly step or join hit it, and SetError `overQuota` in `FileNode/set`. `Blob/upload`, `BlobAssembly/set` create, and copies pre-check free space for the bytes they will add.

## Cleanup without cron

`wgw:jmap:blobs-gc` is not in the schedule. Besides it, a share of `/jmap/upload` and `Blob/upload` requests (`WGW_JMAP_MAINTENANCE_SHARE`, 0.05) runs one bounded round: expired assemblies (releasing their claims), expired blobs, staged copies nobody resumed, orphaned temp files, expired download tickets, and a slice of pending content hashes.

After an append, each consumed part is deleted at once unless the same `blobId` comes back later in that call or a reference checker vetoes it. The checkers (`JmapBlobGarbageCollector::CHECKERS`, also used by the GC) are:

- `BlobAssemblyClaimChecker`: another open assembly claimed the part (uploaded with `Wgw-Assembly-Id`);
- `FileNodeAttachChecker`: a FileNode attach is still copying the blob (`in_use_until`, or a staged copy).

The assembled result is never deleted by this step.

## Tables

`jmap_blob_assemblies`, `jmap_blob_assembly_parts`, `jmap_blob_claims`, `jmap_download_tickets`, `jmap_content_hash_jobs`, `jmap_attach_staging`, plus `jmap_file_nodes.hash_pending` and `jmap_blobs.in_use_until`. See [sql-schema.md](../sql-schema.md).
