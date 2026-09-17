# Docs image insert (Drive picker + hidden attachments)

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `docs_image_insert_f5c8e354`. Delivery Epic [#753](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/753); Goal [#406](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/406).

## Goal

Ship Docs image insert: hidden `.attachments/{docFileNodeId}/` FileNodes with inherit-ACL + DAV sidecar, a reusable Drive `file-select` picker on the existing Move dialog + grid, and Docs editor insert/resolve of `drive:fn-` references.

## Non-goals

See [spec.md](./spec.md#non-goals). In particular: no Notes/Chat/Mail, no server thumbs, no copy-on-insert, no cross-doc refcount, no 2PC, no clone-on-copy, no third listing UI.

## Affected packages

- packages/api | packages/apps

## Dependencies

1. **Chunk 0** (this worktree's spec files + GitHub Epic/Tasks) before any build.
2. **A** and **B** in parallel after 0, each in its own worktree off `origin/main` (or off `feat/docs-image-insert` after 0 is on that branch). Do **not** implement on the dirty `sabre-installer` checkout.
3. **C** after A + B merge.
4. **V** after A/B/C merge.

## Chunks

### Chunk 0: Issues + spec

- **id:** `gov-406-spec`
- **Skill:** plan-feature / issue-filing
- **Inputs:** Goal #406; Epic #753; Tasks #754–#756; re-grep `FileNodeIndexService::isIndexedDotSegment` on origin/main
- **Done when:** #406 body updated (hidden `.attachments`, insert-from-Drive strict ACL, GC-on-destroy, sidecar follow, native DAV, cross-doc reuse not tracked, duplicate/copy does not clone); Epic+Tasks filed with implementable AC; `spec.md` / `plan.md` / `tasks.md` hashed from Epic #753
- **Verify with:** `gh issue view 406/753/754/755/756`; spec header `Source: #753 (body-hash: 99db6714)`; worktree off `origin/main`
- **Parallel with:** none

### Chunk A: API hidden attachments + ACL

- **id:** `api-doc-attachments`
- **Skill:** api
- **Inputs:** `FileNodeIndexService::isIndexedDotSegment` (add `.attachments` beside `.Trash`), `FileNodeSetService::applyUpdate` / `destroyNode`, `DriveService::renameItem` / `deleteItems`, `FileNodeIndexPlugin` (or sibling) `afterMethod` DELETE/MOVE including collection subtree Docs, `WebdavWriteGuardPlugin` forbid client writes under `.attachments/`, hide `.attachments` from DAV `getChildren`, `DriveShareAuthorizer`, `FileNodeBlobResolver`, existing JMAP upload + `FileNode/set`. Task [#754](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/754).
- **Done when:**
  - `.attachments` is indexed but browse-hidden
  - upload creates `{principal}/.attachments/{docFnId}/{imageFnId}.{ext}`
  - inherit-ACL tests: owner, group member, path-share viewer, stranger 403
  - content-by-id IDOR: known attachment node id + no `mayView` on the Doc path → 403/404 (explicit test)
  - sidecar follow on `FileNode/set` parentId personal↔group, REST `renameItem`, and DAV MOVE; idempotent `relocateForDoc`; step-2 failure logs and does not roll back the Doc; no 2PC
  - GC on JMAP destroy, REST `deleteItems`, and DAV DELETE of the file or ancestor collection; trash-move does not; idempotent `destroyForDoc`; single-Doc ownership (GC test is one Doc)
  - DAV: `.attachments` hidden from PROPFIND children; client mutating that prefix is 403; service still deletes/moves via Flysystem
  - Yjs/markdown never required on the server
- **Verify with:** PHPUnit feature tests + `composer done-gate` / `pnpm test:api-done-gate`
- **Parallel with:** B (after 0)

### Chunk B: Iterate Move dialog + Drive grid/list (no new listing UI)

- **id:** `ui-drive-media-picker`
- **Skill:** apps-ui / workspace
- **Inputs:** `DriveMoveToDialog`, `DriveFolderPicker`, `DriveGridView` / `DriveListView`, `useDriveGridPreviews`, `canBrowserPreviewImage`; existing Drive/Docs-home stories as fixtures. Task [#755](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/755).
- **Done when:**
  - `file-select` mode on the Move-dialog/picker: browse like Move To, body is Drive grid (tiles with existing image previews) not `DestinationPickerList`
  - single-select an image; folders navigate; non-images omitted
  - Upload control in the dialog footer; Move To (`folder-destination`) unchanged
  - no new `*-media-picker` CSS fork of `.drive-grid` / `.drive-file-tile` (same contract as docs-home)
  - mock-tier Storybook of the dialog in file-select mode
- **Verify with:** Vitest + Storybook; `pnpm test:apps-done-gate` before handoff
- **Parallel with:** A (after 0)

### Chunk C: Docs editor insert + resolve

- **id:** `ui-docs-image-insert`
- **Skill:** workspace (collab: pure lib vs thin orchestrator per [collab-hooks.md](../../skills/workspace/collab-hooks.md))
- **Inputs:** A + B; `text-editor-slash-menu.tsx`, format bar, `DocsCollabEditor`. Task [#756](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/756).
- **Done when:** slash + toolbar open picker or upload; paste/drop image files upload then `setImage`; custom Image attrs round-trip markdown images whose src is a `drive:fn-` reference, plus Yjs; node view resolves via authenticated download to `blob:`; external `https://` images still work; `.txt` docs stay image-free; track-changes/export does not embed bytes
- **Verify with:** Vitest on parse/serialize + RTL on insert; stories with fixture `drive:fn-` images
- **Parallel with:** none (after A + B)

### Chunk V: Cross-chunk verify

- **id:** `verify-753`
- **Skill:** verify-issue / code-review
- **Inputs:** merged A+B+C; Epic #753 (not Goal #406)
- **Done when:** verifier `PASS` or `PASS_WITH_NITS`; parent ran [done-checklist](../../skills/developer/done-checklist.md); [verify-issue](../../skills/verify-issue/SKILL.md) on the Epic
- **Verify with:** Epic AC checklist; `pnpm test:api-done-gate` + `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: inherit ACL matrix; hidden from `GET /files/children`; FileNode index includes `.attachments`; path-share viewer can download via content-by-id; IDOR 403/404 when the caller has the attachment id but not Doc `mayView`; sidecar follow on `FileNode/set` parentId across principals; DAV DELETE of a `.md` GCs `.attachments/{docId}/`; DAV DELETE of a parent folder GCs each Doc in the subtree; DAV MOVE across group trees relocates; DAV PROPFIND does not list `.attachments`; DAV PUT/DELETE under `.attachments` is 403; relocate/destroy idempotent on second call; GC on destroy not on trash (single-Doc fixture — does not assert behavior when a second Doc still references the same `fn-`)
- [ ] UI: markdown/Yjs round-trip of `drive:fn-`; picker selects image; upload lands under hidden prefix; broken-image when viewer cannot `mayView` a linked Drive file
- [ ] No Playwright in done gates

## Doc updates (only if user wants)

- None in Chunk 0. Later chunks may add architecture notes only if the user asks.
