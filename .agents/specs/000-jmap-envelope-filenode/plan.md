# JMAP envelope: files (FileNode) — plan (draft)

Derived from [spec.md](./spec.md). Umbrella sequencing: [../000-jmap-envelope-multidomain/plan.md](../000-jmap-envelope-multidomain/plan.md).

## Dependencies

1. Chunk F0 (design doc) before chunk F — the node-identity decision shapes everything else.
2. Chunk F needs the blobs chunk ([../438-jmap-blobs/](../438-jmap-blobs/plan.md)) and umbrella chunk P.
3. F0 itself has no dependencies — can start any time, parallel with P and the mail design doc.

## Chunks

### Chunk F0: node-identity design (no code)

- **Deliverable:** design doc (this folder or `packages/api/docs/files/`) resolving the path-addressed-storage problem ([spec.md §The core problem](./spec.md)).
- **Skill:** plan-feature, api
- **Done when:**
  - `jmap_file_nodes` index schema decided (id, parent id, name, blobId/size, timestamps, per-account change counter) incl. how it powers `FileNode/changes` and `/query`;
  - maintenance strategy for BOTH write paths (REST drive, WebDAV) chosen — event hooks vs wrapping the Flysystem adapter — with index-drift failure-mode analysis;
  - backfill strategy for existing trees;
  - drive-shares → inherited `myRights` mapping sketched; symlink exposure decided;
  - maintainer review; chunk F's Task derives its AC from this doc.
- **Parallel with:** umbrella chunk P, mail design doc.

### Chunk F: files envelope build

- **Branch:** `feat/jmap-envelope-filenode`
- **Skill:** api
- **Inputs:** F0 design doc; blobs chunk; draft-ietf-jmap-filenode-14 (pinned).
- **Done when:**
  - `jmap_file_nodes` index maintained by REST drive and WebDAV write paths; backfill in place;
  - `FileNode/get|changes|set|copy|query` registered; `FileNode/queryChanges` → `cannotCalculateChanges`;
  - `onExists` (null/`replace`/`rename`/`newest`), `onDestroyRemoveChildren`, `alreadyExists` SetError with `existingId` per draft-14;
  - rename/move id-stability pinned; WebDAV-side write visible in `FileNode/changes`;
  - `myRights` derived from drive shares with tree inheritance; `shareWith` writes deferred; `webWriteUrlTemplate: null`;
  - blob-content lifecycle: create file node from uploaded blob; referenced blobs GC-protected;
  - capability object honest (`maxSizeFileNodeName`, `caseInsensitiveNames`, …).
- **Verify with:** lifecycle contract test; `composer done-gate`; OpenAPI + docs; draft revision pinned in tests.
- **Parallel with:** mail read-only chunk (different service area; both after blobs).

## Test plan

- [ ] `JmapFileNodeMethodsTest` per method; lifecycle contract test (spec §Verification)
- [ ] Id-stability on rename/move; WebDAV write visibility; `onExists` matrix incl. `"newest"`
- [ ] Share-revocation visibility case (spec §Edge cases)
- [ ] `composer done-gate`
