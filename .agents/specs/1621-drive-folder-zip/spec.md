Source: #1621 (body-hash: e459b02c)
Goal: WeGotWorkspace/Product#130

# Download a Drive folder as one zip, streamed by the server

Technical translation of Task #1621. The issue is the source of truth for every acceptance criterion; this file records how the server and the client meet it and settles the points the issue leaves open.

## Goal

A signed-in user downloads a Drive folder, with its subfolders and files, as `<folder name>.zip`. The client asks for a folder ticket and hands its URL to the browser, which saves the response natively. The server walks the folder and writes a stored (uncompressed) zip straight to the response. Memory use does not grow with folder size, and a host with `memory_limit = 128M` and `max_execution_time = 30` finishes a folder of several GB.

## Non-goals

Copied from #1621: uploading a folder, other archive formats, resuming a dropped zip download (no `Range`), Doc images, several selected items as one zip, folder download through a guest share link, compression.

## Affected packages

- `packages/api`: migration, model, services under `app/Services/Drive/FolderZip/`, controller, routes, OpenAPI, feature and unit tests
- `packages/apps`: ticket client in `lib/api/wgw/drive-download-ticket.ts`, `downloadFolder` on the Drive operations, the three menus, Vitest

The server and the client ship together in one PR.

## Settled decisions

### Zip writer: our own stored-only writer, no new dependency

`maennchen/zipstream-php` declares `ext-zlib`, which is not in `InstallerEnvChecker`'s list. Stored entries need no deflate, so the server uses a small pure-PHP writer, `ZipStreamWriter`, instead. It needs only `hash('crc32b')` (core `ext-hash`). No extension is added to the installer check, and no package is added to `composer.json`.

The writer:

- writes a file below 4 GiB in one pass: local header (general purpose bit 3 = CRC and sizes in a data descriptor, bit 11 = UTF-8 name), the bytes in 1 MiB chunks, then the data descriptor with the CRC-32 and the size actually read. Reading stops at 4 GiB − 2 bytes
- writes a file of 4 GiB or more as ZIP64 in two reads of the same handle: first for its CRC-32, then into an entry whose local header carries the CRC and the sizes (ZIP64 extra field), with no data descriptor. macOS Archive Utility and `ditto` cannot extract a ZIP64 entry whose sizes are only in a data descriptor (checked by hand, also with Info-ZIP's own streamed output); `unzip`, libzip, libarchive and Python can. The cost is one extra read of each such file, during which no bytes are sent
- writes directory entries (`name/`, size 0) without a descriptor
- sets the modification time from the file (`fstat` of the opened stream, else the storage `lastModified`) twice: as the MS-DOS time and as an extended-timestamp extra field (`0x5455`, UTC)
- adds a ZIP64 extra field with the offset to a central record whose local header starts at 4 GiB or later
- writes the ZIP64 end-of-central-directory record and locator when there are 65,535 entries or more, or the central directory's size or offset reaches 4 GiB
- appends each central record to an `SplTempFileObject` (`php://temp`, in memory up to 1 MiB, then a temporary file) while the zip is written, and copies it to the output at the end. This is the only temporary storage: about 100 bytes per entry. The folder's content is never buffered

### A file that changes or disappears during the walk

An entry's header is written only after its stream opened, so a file that is gone before it opens is left out. Below 4 GiB, the descriptor and central record hold the CRC and size of the bytes actually read, so a file that grows, shrinks, or fails mid-read is included as read and the zip stays valid.

A file of 4 GiB or more is read twice from one open handle. A replace by rename (how uploads attach) does not affect that handle. A rewrite in place between the two reads makes the second read differ: its bytes are cut or zero-padded to the size of the first read, so the archive structure stays valid and every other entry extracts; that one entry fails its CRC check.

### Folder tickets: a separate table with the same rules as #1500

`drive_folder_download_tickets` holds `secret_hash`, `username`, `node_id`, `zip_name`, `session_family`, `issued_at`, `last_seen_at`, `absolute_expires_at`. `FolderDownloadTicketService` reuses `DownloadTicketService::SECRET_PATTERN`, `hashSecret()`, and the `TOUCH_INTERVAL_SECONDS` streaming touch. The idle expiry, lifetime and pruning live in a small `TicketExpiry` helper on the same config keys (`wgw.jmap.download_ticket_idle_minutes`, `…_lifetime_hours`); `DownloadTicketService` can move onto it after #1622, which changes that service, has landed. It is a separate table so that file tickets, which #1622 is extending to guests, and folder tickets never redeem each other's secrets.

- `POST /api/v1/jmap/folder-download-tickets/{accountId}` with `{"nodeId": "fn-…"}` → 201 `{url, name, idleExpires, absoluteExpires}`. 404 for a node that is not a live, visible, readable directory of this account; 403 `session_required` without a session-bound token
- `GET /api/v1/jmap/folder-download-ticket/{secret}/{name}` → 200 `application/zip`, unauthenticated, `throttle:240,1`. Every request re-checks expiry, the sign-in session, that the account is enabled, and that the folder is still live, visible and readable. Unknown or refused → 404 problem JSON
- `Accept-Ranges: none`, no `Content-Length` (sizes are only known as files are read), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `X-Accel-Buffering: no`, and `Content-Disposition` with an ASCII `filename` plus `filename*=UTF-8''…`
- the response calls `set_time_limit(0)` when the function is available, and stops writing when the connection is aborted
- the response sink flushes the front controller's self-flushing 64 KiB output buffer after every write, so the headers and the first entries reach the browser at once instead of after the first 64 KiB

### What goes into the zip

`FolderZipWalker` walks the node index depth-first from the folder, reconciling each directory with the disk first (as `FileNode/query` does), and loading children in chunks so a large directory is never held in memory at once:

- the top entry is the folder's name; every subfolder gets its own entry, so empty folders survive
- a node whose name starts with `.` is left out with its subtree: trash (`.Trash`), notes (`.notes`), Doc attachments (`.attachments`), Yjs sidecars (`.{name}.yjs`), and any other hidden name
- tombstoned (deleted) index rows are left out
- each directory and each file is checked with `FileNodeMapper::rightsFor(…)['mayRead']` (through `FolderZipReadCheck`); an unreadable directory is left out with its subtree. Today a readable folder never holds an unreadable subfolder (the most specific share grant wins, and no access level removes reading), so the feature test swaps in a stricter check to prove the rule

### Entry names

Names come from storage and are not caller input, but they are still made safe for any extractor (zip-slip): `/`, `\`, and control characters become `_`, a name that would be empty, `.` or `..` becomes `_`, and every entry path is the folder name plus the sanitized names joined by `/`. Two names in one folder that collide case-insensitively after sanitizing (for example `Report.txt` and `report.txt`, which overwrite each other on macOS and Windows) get ` (2)`, ` (3)`, … before the extension.

### Client

`issueFolderDownloadTicket(session, nodeId)` posts the node id; `downloadFolderAsZipWithTicket(session, path, username)` resolves the folder's node id from the path and calls `startNativeDownload(url, name)`. The client never builds the zip or a `Blob`. Drive operations get `downloadFolder(path)`; guest sessions have no folder download. The row menu, the detail panel and the selection bar (one folder selected) show *Download as zip* for folders.

## Edge cases

- A folder shared with the caller (member grant): the walk uses the caller's rights, so a subfolder the caller cannot read is left out
- A share withdrawn after the ticket was issued: the next request is 404
- A file removed between listing and opening: left out; removed mid-read: included as read
- Non-ASCII names: stored as UTF-8 with bit 11; the download name uses `filename*`
- A folder with 65,535 entries or more, or past 4 GiB: ZIP64 end records
