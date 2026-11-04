Source: #1715 (body-hash: 1013a5d0)
Goal: WeGotWorkspace/Product#140

# Guests upload into a shared folder through the upload queue

Technical translation of Task #1715. The issue is the source of truth for every acceptance criterion; this file records how the API and the client meet it and settles what the issue leaves open. Sub-issue #1716 is handled here too (see "Relation to #1716").

## Goal

Someone outside the organisation who opens a share link to a folder that allows it can drop files into that folder. The files go through the same upload queue, parts, assembly, and version check that signed-in users get (Epic #1499). Nothing else opens up: the guest still cannot see outside the shared folder, rename, move, delete, create folders, or edit Docs.

## Non-goals

Copied from #1715: guest folder create, rename, move, and delete (#1712); guest editing in Docs (#1713); uploads from other apps. Also out of scope: offline uploads for guests (a guest has no offline Drive), the guest invite picker for email invites (it is not rendered, see #1716), and a refresh flow for the one-hour guest token.

## Affected packages

- `packages/api` (routes, guest JMAP gateway, share rules, FileNode account context, rate limiting, OpenAPI, tests)
- `packages/apps` (guest Drive operations and upload queue wiring, Drive upload gate, share dialog link level)

## Facts this design rests on

- A guest session exists only through a public share link: `POST /files/share-sessions` with the link token (`DriveShareService::createSessionFromPublicToken`). Email invites are accepted by a signed-in user (`POST /files/share-sessions/accept`, `wgw.role:user`) and become member grants. So "guest" in #1715 means a public-link session: `role: guest`, subject `share:{sessionKey}`, JWT and session both live at most one hour, no refresh.
- Public links are capped at `view` today (`DriveShareRules::assertPublicAccessCap`). A guest session's rights are the link's `default_access` (`DriveShareAuthorizer::resolvePathContext`), so no guest can hold `edit` today.
- The upload queue (#1501, #1519, #1520) speaks JMAP only: `GET /jmap/session`, `POST /jmap/upload/{accountId}` with `Wgw-Part-*` headers, `BlobAssembly/*`, `FileNode/get|query|set` with `expectedBlobId`. All of these sit in the `wgw.role:user` route group.
- In JMAP, adding a child needs `mayAddChildren`, which `FileNodeMapper::rightsFor` grants only for `full` (`mayManageStructure`). A member with `edit` on a folder can change file contents but cannot add files.
- Docs collaboration refuses every guest (`DocCollabDocumentService::readableDocument`), so an `edit` link does not open Docs editing.

## Decisions

### Link levels

- A public link to a **folder** may be `view` or `edit`. A public link to a **file** stays `view`. `comment`, `review`, and `full` stay refused on every public link (400, same `bad_request` shape as today). The check runs on create and on every `defaultAccess` update; the folder test reads the files disk at that moment.
- `full` is not offered to links: it would promise rename, move, and delete, which guests do not get (#1712). This is the same reason #1716 gives for not offering levels that do not work.
- For a guest, `edit` on a folder means: add files into the folder and its subfolders, and replace the contents of existing files there (that is what `edit` already means for members). It does not mean create folders, rename, move, or delete.
- Existing public rows with `full` (only reachable by editing the database) behave like `edit` for uploads; the guest write rules below still refuse structure changes.

### Guest JMAP gateway

- Separate guest routes, so the member routes stay untouched:
  - `GET /jmap/session` moves out of the `wgw.role:user` group into a `wgw.auth` group. The controller answers members exactly as before and hands a guest to the guest gateway.
  - `POST /jmap/guest` (the guest `apiUrl`) and `POST /jmap/guest/upload/{accountId}` (the guest `uploadUrl`), in a `wgw.auth` group with `wgw-api`, the guest share limiter, and a role check that admits **only** `guest`.
  - The guest Session's `downloadUrl` and `eventSourceUrl` point under `/jmap/guest/…` and are not served (404): guests read through `GET /files/content` as before, and get no push.
- **Gate on every guest JMAP request** (session, API, upload), before any body is read: the session key resolves to a live `drive_share_sessions` row and a live share (`DriveShareAuthorizer::resolvePathContext` on the share root, which already checks session revoked/expired, share revoked/expired, owner reach, and product trash), the share root is a directory on the files disk, and the rights at the root include `mayEditContent`. Otherwise `403 {code: "guest_upload_forbidden"}`. A view link therefore cannot even open the guest Session.
- **Account id:** `guest-` plus the first 32 hex of `sha256("wgw-guest-upload:" . sessionKey)`. It is not a username shape a member can hold in practice and never appears in member routes. Blobs, parts, assemblies, and staged copies of a guest live under this id, so a guest can only attach bytes it uploaded in this session (`JmapBlobService::find` is per account) and never the owner's blobs.
- **Account context:** a request-scoped `GuestJmapAccounts` registry, filled only by the gate for the authenticated guest. `FileNodeAccountSupport` consults it first: for a registered guest account `principalFor` returns `{username: "share:{sessionKey}", role: "guest"}`, `accountRootsFor` and `rootsFor` return the share root's storage key only, and `ensureAccountIndexed` indexes that root. Nothing infers a guest from the shape of a name.
- **Methods:** a guest dispatcher with its own method list: `Core/echo`, `FileNode/get`, `FileNode/query`, `FileNode/set` (behind the guest write rules), and `BlobAssembly/set|append|finish|get`. Every other method answers `unknownMethod`; `using` accepts only core, FileNode, blob assembly, and the FileNode version check. No `Blob/upload`, `Blob/get`, `FileNode/copy`, `FileNode/changes`, or `Quota/*` (the owner's free space and usage are not shown to anonymous callers; the client's space check reads "unknown").
- **Reads one folder at a time:** guest `FileNode/get` needs `ids` (no get-all), and guest `FileNode/query` takes only `isTopLevel: true` or `parentId` (with optional attribute conditions, `depth` absent or 0, no `ancestorId`, no filter operators). A get-all or an unfiltered query reconciles the whole shared tree (up to 2000 folders); an anonymous caller must not be able to start that. This matches what `GET /files/children` already lets a guest read, and it is all the upload queue asks.
- **Guest write rules** (checked before `FileNodeSetService::apply`; a refused entry is a SetError `forbidden`, the call itself is answered):
  - `destroy` is refused for every id.
  - `create` must be a file with a `blobId` (no `nodeType: "directory"`, no `note`); allowed keys `parentId`, `name`, `nodeType: "file"`, `blobId`, `size`, `type`.
  - `update` may only carry `blobId`, `size`, and `expectedBlobId`, and must carry `expectedBlobId` (a guest never overwrites blind).
  - `onExists` must be absent or null (`replace` would destroy a sibling).
- **Rights:** `FileNodeMapper::rightsFor` gives a guest principal `mayAddChildren` when it has `mayEditContent` at that path. `mayRename` and `mayDelete` stay as they are; the write rules above refuse them anyway. Everything else (visibility, `parentId` inside the share, name validation, version check, attach, staging, 507 / `overQuota`) is the member path unchanged.

### Limits

- **Requests:** a named limiter `wgw-guest-upload` keyed on `share:{shareId}` (the guest cannot mint share ids; it can mint session keys, up to 10 per link per hour through the existing session limiter). 300 requests per minute per share, shared by every guest of that link, on top of the per-session `wgw-api` bucket. A 429 carries `Retry-After`.
- **Bytes:** a byte budget per share in shared cache, charged from `Content-Length` before the body is read: `WGW_GUEST_UPLOAD_BYTES_PER_DAY` (default 10 GiB, 0 = no budget) over a 24 h window. A guest part upload without `Content-Length` is refused with 411. Over budget → 429 `guest_upload_budget` with `Retry-After`. PHP stops reading at `Content-Length`, so the charge is an upper bound of what is stored.
- **Size and space:** the member limits apply unchanged (`maxSizeUpload` per part, `maxSizeAssembly`, the free-space pre-checks of `BlobAssembly/set`, 507 and `overQuota`). The files land in the owner's tree, so they count against the owner's root (`dq-{rootNodeId}`), as the issue asks.

### Revocation and expiry mid-upload

- The gate runs on every request, so revoking the link, revoking all public links, changing the password (it revokes sessions), lowering the link to `view`, expiry, or the owner losing reach stops the next part, append, or create with 403. A part already being received when that happens may finish into the guest's own blob space; it is never placed and expires with the blob TTL.
- The guest token lives one hour. The client keeps the queue for that session only: a guest who reopens the link gets a new session and starts the remaining files again (documented limit).

### Client

- A guest gets the upload queue only when the server opens its upload Session: `driveJmapSession()` succeeds (an edit link to a folder) and the account id has the guest shape. A view link answers 403, so the guest Drive keeps refusing uploads with `GUEST_UPLOAD_UNAVAILABLE`. Nothing is guessed from cached share state.
- The queue runs under the guest's JMAP account id (`guest-…`), not under the username the guest Drive shell shows (that is the share owner's, and the owner may use the same browser). Queue rows, blobs, and placeholders live in that account's offline database. JMAP calls go through the guest Session (`apiUrl` / `uploadUrl`), as for members.
- `driveJmapSession` remembers which sign-in its cached Session belongs to (member, or guest plus share path), so a tab that turns from member into guest never reuses the member Session. For a guest, the share root path (`wgwGuestSharePath`) maps to the account's only top-level node (`FileNode/query {isTopLevel: true}`); the shared-with-me list (members only) is never called.
- `JmapClient.connect` accepts a Session that offers FileNode only.
- The Drive inbound FileNode sync never runs for a guest: the guest shell's username is the owner's, whose offline data this device must not touch.
- The Drive upload gate (`isDriveUploadEnabled`) is "member, or a guest whose Drive has the upload queue". A guest who may upload gets an "Upload files" sidebar button and the drop target, but no New folder and no new Markdown file (#1712). The sidebar footer says "Can view and add files" instead of "View only".
- The share dialog's public link card gets a "People with the link" choice for folders: "Can view" and "Can add files" (`edit`), with a matching hint. File links (and every Docs share dialog) show no choice. A legacy `full` row shows as "Can add files".

## Relation to #1716

#1716 asks the guest **email invite** picker to offer only `view` until guest uploads work. That picker (`ShareGuestSection`) is not rendered anywhere, and an accepted email invite becomes a member grant (`acceptInvite` needs a signed-in user), not a guest session. With this Task, guests can upload, which is the condition #1716 waits for, and #1715 asks to offer edit again. So #1716 has nothing left to build: it closes with the client PR. Its one reporting item is answered here: `comment` and `review` do not work for a guest session, because every `files/threads` route is in the `wgw.role:user` group, and Docs collaboration refuses guests.

## Edge cases

- A guest upload into a subfolder of the share: allowed (`isWithin` the share root); a `parentId` outside the share root is `invalidProperties` (not visible), never `forbidden` with a hint.
- A name with `/`, `\`, NUL, `.`, or `..`: `invalidProperties` (member validation).
- A guest replacing a file another guest just replaced: `versionMismatch`, as for members.
- A share whose folder is moved by the owner: share paths follow (`rewritePathPrefix`); the next gate check uses the new root.
- A share moved into the product trash: denied by `resolvePathContext`.
- Two guests of the same link: separate accounts and blob spaces, one request limiter and one byte budget.
