# Task issue draft — file manually, then renumber this folder

File via `.github/ISSUE_TEMPLATE/task.yml`, then:

1. `git mv .agents/specs/000-jmap-blobs .agents/specs/<N>-jmap-blobs`
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

---

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic ([../000-jmap-envelope-multidomain/issue-drafts.md](../000-jmap-envelope-multidomain/issue-drafts.md)) · **Branch:** `feat/jmap-blobs`

## Title

```
feat(api): real JMAP blob upload/download (RFC 8620 §6)
```

## Body

```markdown
Parent: #<epic>
Depends on: #<chore P>

Replace the `JmapStubController` 501 stubs with real RFC 8620 §6 blob
upload/download. Shared prerequisite for the files envelope (FileNode
content), the mail envelope (bodies/attachments/drafts), and contacts photo
blobIds.

Spec: `.agents/specs/<N>-jmap-blobs/`

### Acceptance criteria

- [ ] `POST /jmap/upload/{accountId}` stores a blob (table: id, account, sha-256, size, type, expiry; Flysystem-backed content) and returns the RFC 8620 §6.1 response
- [ ] `GET /jmap/download/{accountId}/{blobId}/{name}` streams it back with account scoping enforced
- [ ] Unreferenced-blob GC with domain-owned reference protection (a blob referenced by a contact card — later a FileNode — is never expired; draft-filenode-14 hard requirement)
- [ ] Session advertises an honest non-zero `maxSizeUpload`; upload size limit enforced with the RFC error shape
- [ ] Contacts `media` accepts envelope-uploaded blobIds without breaking `POST/GET /contacts/blobs` REST consumers
- [ ] EventSource stays 501 (push remains a non-goal)
- [ ] Round-trip + GC-protection feature tests; OpenAPI updated; `composer done-gate`
```
