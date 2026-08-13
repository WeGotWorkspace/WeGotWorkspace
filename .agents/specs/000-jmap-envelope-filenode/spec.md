Source: ad-hoc (design Task F0 filed as **#439**; the build Task F is filed after #439 lands — see [issue-draft.md](./issue-draft.md) — then rename this folder to `<N>-jmap-envelope-filenode` with the build Task's number and set its body-hash here). Parent epic: #435. Umbrella roadmap with sequencing and shared constraints: [../000-jmap-envelope-multidomain/](../000-jmap-envelope-multidomain/spec.md).

# JMAP envelope: files (FileNode, draft-ietf-jmap-filenode-14)

Expose the drive as JMAP FileNodes behind `urn:ietf:params:jmap:filenode`. **Status: draft, planning-only.** Two-step: a node-identity design decision (F0, document only) gates the build (F).

## External spec

**draft-ietf-jmap-filenode-14** — active Internet-Draft (2026-05-15, expires 2026-11-16), verified against the IETF datatracker 2026-08-13. Still moving: draft-14 added `onExists: "newest"` and `caseInsensitiveNames` recently; IESG-submission milestone (Jun 2026) has slipped and the IESG state is "I-D Exists". **Pin the draft revision (`-14`) in docs and tests**; expect wire-level churn until IESG submission and budget a revision-bump pass per new draft.

## Goal

`FileNode/get|changes|set|copy|query` (+ `queryChanges` → `cannotCalculateChanges`) over the existing drive, with draft-14 semantics: stable node ids, `onExists` collision handling, `onDestroyRemoveChildren`, inherited `myRights`, blob-backed file content.

## Non-goals

- `shareWith` writes (RFC 9670) — read-only `myRights` mapping only, consistent with the REST sharing posture.
- `webWriteUrlTemplate` direct HTTP writes — advertised as `null`; clients use `FileNode/set` + blob upload.
- Blobext/ArchiveEntry integration (draft's optional archive extraction) — out of scope.
- Symlink nodes — decide in F0 whether to expose them at all (`nodeType: "symlink"` is optional server behavior; the Flysystem drive has no symlink concept).

> **F0 delivered:** the design doc lives at [`packages/api/docs/files/jmap-filenode-design.md`](../../../packages/api/docs/files/jmap-filenode-design.md) (#439). The build Task derives its AC from that document; the section below is the original problem statement.

## The core problem (chunk F0 resolves this)

FileNode ids must be **stable across rename/move** — `name` and `parentId` are mutable properties on an immutable id — while the drive is path-addressed Flysystem: `app/Dav/Storage/FlysystemNode.php` / `FlysystemFile.php` / `FlysystemDirectory.php` (WebDAV) and `FilesController` (REST) both address nodes by path, and Flysystem has no changelog to back `FileNode/changes`.

Proposed direction (F0 validates or replaces it): a `jmap_file_nodes` index table — node id, parent id, name, blobId/size, timestamps, per-account monotonic change counter — maintained by **both** write paths (REST drive and WebDAV). The same index yields `FileNode/changes` (rows with counter > sinceState) and `FileNode/query` sorting. This is the only envelope chunk that touches existing write paths rather than purely adding an adapter; F0 must include a failure-mode analysis for index drift (out-of-band writes, crashed half-updates) and a backfill strategy for existing trees.

## Technical constraints

1. **Blob dependency** — every file node's content is a `blobId` (non-null for files, incl. zero-byte; null for directories). Hard dependency on the blobs chunk ([../438-jmap-blobs/](../438-jmap-blobs/spec.md)), including its reference-protected GC (a blob referenced by a live FileNode must never be collected — draft-14 hard requirement).
2. **Rights mapping** — existing drive shares (`DriveSharesController`, share sessions) map onto the draft's inherited `myRights` (`mayRead`, `mayAddChildren`, `mayRename`, `mayDelete`, `mayModifyContent`, `mayShare`, …). Tree inheritance: rights derive from ancestors; when a share change alters derived rights of descendants, those descendants must be reported in `FileNode/changes` (draft §sharing).
3. **Sibling name uniqueness** — `FileNode/set` must order creates/destroys so the sibling-uniqueness constraint holds at transaction end while allowing atomic replace; `onExists` values null (→ `alreadyExists` SetError with `existingId`), `"replace"`, `"rename"`, `"newest"` per draft-14; `compareCaseInsensitively` honored or capability `caseInsensitiveNames` advertised truthfully.
4. **Capability object** — account-level `urn:ietf:params:jmap:filenode` object with honest values: `maxSizeFileNodeName`, sort-property list, root-node creation permission, `caseInsensitiveNames`, `webWriteUrlTemplate: null`.

## Edge cases to pin in tests

- Rename/move keeps the node id stable and yields exactly one `updated` entry in `FileNode/changes` (no destroy+create pair).
- A WebDAV-side write (upload via the DAV front) is visible in the next `FileNode/changes` — the index is protocol-agnostic.
- `onExists: "newest"` replaces only when the incoming `modified` is strictly later.
- Destroying a directory without `onDestroyRemoveChildren` → SetError; with it → children reported `destroyed`.
- Share revocation on a parent → descendants disappear from the account's visible set (`destroyed` or rights-updated per draft §discoverability).

## Verification

Lifecycle contract test (mkdir → upload blob → create file node → rename/move → changes → destroy); id-stability and WebDAV-visibility tests; `composer done-gate`; OpenAPI + docs. Full plan: [plan.md](./plan.md).
