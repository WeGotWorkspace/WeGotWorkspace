Source: #753 (body-hash: 99db6714)
Goal: #406

# Docs image insert (Drive picker + hidden attachments)

Technical translation of Epic [#753](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/753). Product context: Goal [#406](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/406). Child Tasks: [#754](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/754) (API), [#755](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/755) (picker), [#756](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/756) (Docs editor).

## Goal

Docs can insert images two ways — **upload** into a hidden, Doc-keyed attachments tree, or **link** an existing Drive FileNode — while the Yjs/markdown body stores only `drive:fn-{imageNodeId}`. Collaborators inherit the **Doc** ACL for uploaded attachments. Insert-from-Drive stays strict on the source file. The media browser is a `file-select` mode on the existing Drive Move dialog + `DriveGridView` / `DriveListView`, not a third listing UI.

## Non-goals

- Notes ATTACH / Chat file attach / Mail-to-Drive
- Server thumbnails, video, resize handles, DAM tagging
- Expanding `FileNode/query` to shared-with-me listings
- Copy-on-insert from Drive
- Offline-first attachment outbox
- Guest anonymous upload ([#388](https://github.com/WeGotWorkspace/wegotworkspace/issues/388))
- GC of unused images while the Doc still exists
- Deleting insert-from-Drive source files on Doc destroy
- Sidecar follow on same-principal trash-move
- Cross-doc reuse tracking / refcount / insert-time block (GC assumes single-Doc ownership)
- Two-phase commit / rolling back a successful Doc move when sidecar relocate or GC-delete fails
- Cloning `.attachments/{oldId}/` on Doc duplicate/copy (DAV COPY today; `FileNode/copy` stub; no Drive UI copy)
- Sabre ACL inherit for path-share collaborators on `.attachments/` (web content-by-id only)
- Host-disk / out-of-band deletes (`rm` on the volume)
- Changing WebdavWriteGuard zones so native DAV can MOVE users↔groups
- A third Drive listing/tile implementation; teaching `DestinationPickerList` image previews
- Closing Goal #406 (product marks Fulfilled)

## Affected packages

- `packages/api` — FileNode index allowlist, `DocAttachmentsService` (name TBD), inherit-ACL, content-by-id, DAV plugin + write guard, Flysystem hide
- `packages/apps` — `DriveMoveToDialog` / `DriveFolderPicker` `file-select` mode; Docs slash/toolbar/paste; authenticated `blob:` Image node view
- Tests/stories only under those packages; no Playwright in done gates

## Technical constraints

### Storage

Physical path (Doc principal, not uploader):

`/{users|groups}/{principal}/.attachments/{docFileNodeId}/{imageFileNodeId}.{ext}`

Yjs / markdown stores **reference only** (`drive:fn-{imageNodeId}`), never bytes, never mutable `fnb-` blobIds. Do not persist `/jmap/download/…` as `src` — API auth is bearer (`AuthenticateWgwApi`), not cookies. Resolve at render like contact photos (`use-contact-photo-src.ts`): session token → `blob:` URL.

### Index allowlist (re-grep Chunk 0, origin/main)

[`FileNodeIndexService::isIndexedDotSegment`](packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php) currently excepts:

- `PRODUCT_TRASH_DIR` = `.Trash`
- `PRODUCT_NOTES_DIR` = `.notes`
- `PRODUCT_NOTES_ARCHIVE_DIR` = `.archive` **only when** `$underNotes`

Dot segments otherwise skip the index (`isHiddenKey`). Product analog for a **new** hidden-but-indexed folder is `.Trash` (live product trash). `.notes` is leftover migrator trees (VJOURNAL is the Notes store) — do not copy that pattern. Chunk A adds `.attachments` next to `.Trash` in that allowlist.

Drive browse already hides dot names via `isVisibleDriveEntry` / `DriveService::isHiddenNotesPath` (the latter is `.notes`-specific). Attachments rely on the generic client-side dot hide.

### Two insert paths

- **Upload** creates a FileNode under `.attachments/{docId}/`. Collaborators inherit **Doc** ACL for that prefix.
- **Insert from Drive** stores the existing FileNode id — **no copy**. Display uses the viewer's own rights on that file (strict). A personal photo in a shared/group Doc breaks for collaborators who cannot `mayView` that file.

### Sidecar follow + GC (three call sites)

`.attachments/{docId}/` is **not** a child of the Doc file — it sits at the principal root. `recordMove` only re-keys the moved node's subtree, so a Doc move today leaves attachments behind.

Hook **all three** write paths after success:

1. `FileNodeSetService::applyUpdate` (`FileNode/set` `parentId`) and `FileNodeSetService::destroyNode`
2. `DriveService::renameItem` / `deleteItems`
3. Native WebDAV via `FileNodeIndexPlugin` (or sibling) `afterMethod` DELETE/MOVE — including collection subtree Docs. Resolve Doc `node_id`s **before** tombstone.

Same-principal rename / trash-move (`/{principal}/.Trash`): relocate no-op; attachments stay. Cross-principal prefix change (`users/{name}` vs `groups/{slug}`): `relocateForDoc`. Permanent destroy: `destroyForDoc`.

**Two disk steps, not one transaction.** Doc move/destroy can succeed while sidecar fails. Do not roll back step 1. Do not 2PC. Sidecar failure is best-effort + logged (same posture as `file_node_index_sync_failed`). `relocateForDoc` / `destroyForDoc` are **idempotent and retryable**: already at dest / source missing → no-op; already deleted → no-op.

**v1 GC assumes single-Doc ownership.** Destroying Doc A deletes `.attachments/{A}/` unconditionally. A second Doc that stored `drive:fn-` into A's folder is an accepted break (non-goal), not a Chunk A bug.

Insert-from-Drive files are **not** under that prefix — do not delete them on Doc destroy. Removing an image from the live Doc body does **not** delete the FileNode. Do not treat DELETE of a file under `.attachments/` as Doc-GC. Collab `.{name}.yjs` DELETE must not trigger Doc-GC.

### Native WebDAV

A markdown Doc deleted or moved from Finder/Cyberduck never hits `FileNodeSetService` or `DriveService`. Filenode design rejected wrapping the Flysystem adapter; identity stays on `FileNodeIndexPlugin` `afterMethod:{PUT,PATCH,MKCOL,DELETE,MOVE,COPY}`.

Sabre matrix (v1): GET/HEAD/PROPFIND/PUT/PATCH/MKCOL of the `.md` → no sidecar. DELETE `.md` or parent folder → `destroyForDoc`. Same-principal MOVE → no-op relocate. MOVE across group trees (both zone 20) → `relocateForDoc`. MOVE users↔groups is **already 403** (`WebdavWriteGuardPlugin` mutation zones 10 vs 20) — no plugin work; JMAP/REST still can, and that sidecar path stays. COPY → **no** attachments clone.

`.attachments` is server-owned:

- Hide from DAV `getChildren` (PROPFIND of the home). Direct GET by known path may still work for the owner.
- Forbid client PUT/MKCOL/DELETE/MOVE/COPY **under** `.attachments/` and of the `.attachments` root. `DocAttachmentsService` mutates via Flysystem + index, not via DAV.
- Path-share inherit is REST/JMAP content-by-id, not Sabre ACL. Collaborators see images in the web Doc; they do not gain a WebDAV mount of `.attachments/`.

### ACL

`FileNodeBlobResolver` only serves nodes in the account's FileNode roots (own tree + member groups). Shared-with-me is still deferred. Docs collab already uses path grants via `DriveShareAuthorizer`.

For paths matching `/{users|groups}/{principal}/.attachments/{docNodeId}/…`, inherit the Doc's current `mayView` / `mayEditContent`. Add a **content-by-node-id** read so the editor can stream an image when the viewer `mayView` the path even if the node is outside FileNode account roots. Do not expand `FileNode/query` shared-with-me.

**IDOR (own test):** a principal who knows/guesses an attachment `fn-` (or `fnb-`) but does **not** `mayView` the parent Doc path must get **403/404** on content-by-id — including when the node sits outside their FileNode account roots. Same denial for a non-attachment Drive file they cannot `mayView`.

### Media browser (compose, do not replace)

Canonical pieces: `DriveGridView` / `DriveListView` + `drive-browser.css`; `DriveMoveToDialog` + `DriveFolderPicker`; Docs home already embeds the grid (`docs-home-pane.tsx`). Architecture test `drive-browser.css.test.ts` forbids docs-home from re-forking `.drive-grid` / tile selected styles. Image tiles already use `useDriveGridPreviews` + `FilePreview`. Move body today is `DestinationPickerList`: folders selectable, files listed but not choosable, no previews.

Add picker **mode**: `folder-destination` stays Move/New-doc; `file-select` is Insert image. In `file-select`, swap the list body for `DriveGridView` (default) / optional `DriveListView` + `ViewModeToggle`. Filter to folders (navigate) + images (`inferFileKindFromName` / `canBrowserPreviewImage`). Folder-at-a-time; no MIME query on `FileNode/query`. Footer: Cancel/Insert + Upload (`<input accept="image/*">`). Thumbnails are **not** in #406 — reuse full-blob grid previews.

### Docs editor

TipTap already registers `Image` in `text-editor-extensions.ts` (`allowBase64: false`). Missing: slash/toolbar, picker, upload, authenticated `src` resolution, prose `img` CSS. `.txt` docs stay image-free. Track-changes/export must not embed bytes. Collab: split pure lib (parse/serialize `drive:fn-`) vs thin orchestrator per [collab-hooks.md](../../skills/workspace/collab-hooks.md); do not grow `use-docs-collab.ts`.

## Edge cases

- Same-principal rename or Move to Trash: image `src` (`fn-`) stays valid; sidecar folder does not move.
- Cross-principal `FileNode/set` parentId (personal↔group) relocates `.attachments/{docId}/`; REST `renameItem` and DAV MOVE across group trees too.
- Second `relocateForDoc` / `destroyForDoc` after success is a no-op, not an error.
- Step-2 sidecar failure after a successful Doc move/destroy: user-facing operation succeeds; log; leftover folder is a storage leak, not a user-visible break.
- DAV DELETE of a parent folder GCs every Doc in the subtree; idempotent if Sabre also fires per-child DELETE.
- DAV COPY of a `.md` or folder does not clone attachments (broken `drive:fn-` in the copy until re-insert). `FileNode/copy` is a stub (`invalidArguments` same-account).
- Path-share viewer can download attachments via content-by-id without seeing `.attachments` in Drive browse or over DAV.
- Stranger with a guessed attachment id and no Doc `mayView` → 403/404.
- Insert-from-Drive of a private file into a shared Doc: owner sees the image; collaborator without `mayView` on that file sees a broken image.
- Destroying Doc A breaks Doc B if B pointed at A's hidden attachment (accepted v1).
- Out-of-band `rm` on the volume does not fire the plugin (existing FileNode drift limitation).
