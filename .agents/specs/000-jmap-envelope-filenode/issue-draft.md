# Task issue drafts — file manually, then renumber this folder

File via `.github/ISSUE_TEMPLATE/task.yml` (two Tasks: design F0, build F), then:

1. `git mv .agents/specs/000-jmap-envelope-filenode .agents/specs/<N>-jmap-envelope-filenode` (use the **build** Task's number)
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

---

## 1. Task — filenode node-identity design doc (chunk F0)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic ([../000-jmap-envelope-multidomain/issue-drafts.md](../000-jmap-envelope-multidomain/issue-drafts.md)) · **Deliverable:** design doc, no code

### Title

```
docs(api): FileNode node-identity index design for the drive (JMAP filenode)
```

### Body

```markdown
Parent: #<epic>

draft-ietf-jmap-filenode-14 requires stable FileNode ids with mutable
`name`/`parentId`, while the drive is path-addressed Flysystem (REST
`FilesController` + WebDAV `app/Dav/Storage/*`). Produce the design doc that
resolves this before any filenode code is written.

Spec: `.agents/specs/<N>-jmap-envelope-filenode/`

### Acceptance criteria

- [ ] Node-id index schema decided (id, parent id, name, blobId/size, timestamps, per-account change counter) incl. how it powers `FileNode/changes`
- [ ] Maintenance strategy for BOTH write paths (REST drive and WebDAV): event hooks vs wrapping the Flysystem adapter — with failure-mode analysis (index drift)
- [ ] Backfill strategy for existing trees
- [ ] Mapping from drive shares to inherited `myRights` sketched; `shareWith` writes declared out of scope; symlink exposure decided
- [ ] Maintainer review; the build Task derives its AC from this doc
```

---

## 2. Task — files envelope build (chunk F)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic · **Branch:** `feat/jmap-envelope-filenode`

### Title

```
feat(api): JMAP envelope methods for files (draft-ietf-jmap-filenode-14, pinned)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task F0 design>, #<task blobs>

Expose the drive as JMAP FileNodes behind `urn:ietf:params:jmap:filenode`,
per the F0 design.

Spec: `.agents/specs/<N>-jmap-envelope-filenode/`

### Acceptance criteria

- [ ] `jmap_file_nodes` index (per F0) maintained by REST drive and WebDAV write paths; backfill in place
- [ ] `FileNode/get|changes|set|copy|query` dispatched; `FileNode/queryChanges` → `cannotCalculateChanges`
- [ ] `onExists` (null/`replace`/`rename`/`newest`), `onDestroyRemoveChildren`, and `alreadyExists` SetError with `existingId` per draft-14
- [ ] Rename/move keeps the node id stable and yields exactly one `updated` entry in `FileNode/changes`; a WebDAV-side write is visible in `FileNode/changes`
- [ ] `myRights` derived from drive shares with tree inheritance; `shareWith` writes deferred; `webWriteUrlTemplate: null`
- [ ] Blob-content lifecycle: create file node from uploaded blob; referenced blobs protected from GC
- [ ] `draft-ietf-jmap-filenode-14` pinned in docs/tests; lifecycle contract test; OpenAPI + docs; `composer done-gate`
```
