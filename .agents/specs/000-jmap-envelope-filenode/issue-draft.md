# Task issue drafts — F0 filed; file the build Task after #439 lands

**Filed:** design doc F0 = **#439** (2026-08-13). **Remaining:** the build Task
below — file it via `.github/ISSUE_TEMPLATE/task.yml` once #439 is reviewed,
then:

1. `git mv .agents/specs/000-jmap-envelope-filenode .agents/specs/<N>-jmap-envelope-filenode` (the build Task's number)
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

---

## Task — files envelope build (chunk F)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` + `area:drive` + `area:platform` · **Parent:** epic #435 · **Branch:** `feat/jmap-envelope-filenode`

### Title

```
feat(api): JMAP envelope methods for files (draft-ietf-jmap-filenode-14, pinned)
```

### Body

```markdown
Parent: #435
Depends on: #439 (design), #438 (blobs)

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
