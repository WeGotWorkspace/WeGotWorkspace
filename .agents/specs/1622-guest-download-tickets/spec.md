# Guest download tickets (#1622)

Task #1622 under Goal WeGotWorkspace/Product#145. It builds on the download tickets from #1500 and the signed-in ticket download from #1519. The issue is the source of truth for every acceptance criterion; this file records how they are met and settles what the issue leaves open.

## Decisions

- **One ticket mechanism.** A guest ticket is a row in the same `jmap_download_tickets` table, redeemed by the same public route (`GET /api/v1/jmap/download-ticket/{secret}/{name}`), with the same 256-bit secret stored as sha256, the same sliding idle expiry, absolute lifetime, `ETag`, `Range`/`If-Range` handling and `Content-Disposition: attachment`. Only issuing and the liveness check differ.
- **Issuing.** `POST /api/v1/files/download-tickets` with `{ "path": "/users/…/file" }`, on the `wgw.auth` route group a guest can reach. A guest share session (`role: guest`, subject `share:{sessionKey}`) gets a guest ticket. A signed-in caller gets an ordinary ticket bound to its own sign-in session, exactly as `POST /jmap/download-tickets/{accountId}` would give it; signed-in clients keep using that route. The route does not answer 403 to signed-in callers, because every `x-wgw-access: guest` route must accept user and admin tokens (the role-access matrix test) (decided during review of #1864). The server checks `mayRead` for the path with the guest principal, resolves the file's FileNode, and binds the ticket to its current `fnb-{nodeId}-{sha8}` blobId, so the ticket never serves other bytes than it was issued for (same documented exception for hash-pending nodes as #1500). Answer: 201 `{ url, idleExpires, absoluteExpires }`, the same shape as the signed-in route. A path outside the share, a folder, or a missing file answers 404.
- **Binding.** The row stores `username = share:{sessionKey}` and `session_family = share-session:{sessionId}`. Each request re-checks that the share session is not revoked or expired and that its share is not revoked, not expired, and still reachable by its owner, then resolves the blob with the guest principal (so `mayRead` inside the share runs again). Any failure answers 404 and deletes the ticket when the session or share is gone.
- **Session lifetime.** A guest session lives at most one hour (`GUEST_JWT_TTL_SECONDS`, or less when the share expires sooner). A response already streaming is not cut off, but a `Range` resume after the session ended is refused; the guest opens the link again and downloads from the start. This follows from "bound to the share session" in the issue and is accepted for now.
- **Client, guest Drive and share page.** Both ask for a ticket and hand its URL to the browser (`startNativeDownload`), so the file streams to disk; no `fetch` of the content, no `Blob`.
- **Guest `readFileBlob`.** Uses the shared `DRIVE_READ_BLOB_MAX_BYTES` (100 MiB). A guest does not know the size from the path alone, so it refuses when `Content-Length` is above the limit and cancels the body, and it also stops reading when the bytes received pass the limit. Either case throws `DriveFileTooLargeToOpenError`.
- **Grid previews.** Media previews read the file's listed size first and skip the fetch above the same constant, so the tile keeps the file-type icon. This applies to guests and signed-in users alike.

## Out of scope

The signed-in download path and tickets themselves (#1500, #1519), folder downloads (Product#130), guest uploads (#1518), any resume protocol beyond HTTP `Range`, and a refresh flow for guest sessions.

## Tests

- Feature: a guest ticket for a readable file streams it, including a `Range` resume; a ticket request for a path outside the share is refused; a ticket is refused after the share is revoked, after the session is revoked, and after the session expired; a signed-in caller gets a ticket bound to its own sign-in session; the ticket stops serving after the file's content changes.
- Vitest: both guest download paths use the ticket and never call `res.blob()`; guest `readFileBlob` refuses above the limit (by header and by counted bytes); grid previews skip media above the limit.
- Live e2e (`packages/apps/e2e/drive-guest-large-download.spec.ts`, in the live tier): a large file downloaded through a share link as a native download from a ticket URL, once resumed after a dropped connection, with a matching sha256.
