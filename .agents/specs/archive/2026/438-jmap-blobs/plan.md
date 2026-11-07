# JMAP blobs — plan (draft)

Derived from [spec.md](./spec.md). Umbrella sequencing: [../000-jmap-envelope-multidomain/plan.md](../000-jmap-envelope-multidomain/plan.md).

## Dependencies

1. Umbrella chunk P (envelope decoupling) merged.
2. May run parallel with the contacts envelope (coordinate on session capability providers).
3. Downstream consumers: files envelope and mail envelope both hard-depend on this chunk; contacts photo blobIds are upgraded by it.

## Chunks

### Chunk B: real blob infrastructure

- **Branch:** `feat/jmap-blobs`
- **Skill:** api
- **Inputs:** [spec.md](./spec.md); `JmapStubController` (to supersede); `ContactBlobService` / `ContactMediaBlobResolver` (interop decision); RFC 8620 §6.
- **Done when:**
  - `POST /jmap/upload/{accountId}` stores a blob (table + Flysystem content) and returns the §6.1 response shape;
  - `GET /jmap/download/{accountId}/{blobId}/{name}` streams with account scoping, `type`/`name` reflected per §6.2;
  - unreferenced-blob GC with domain-owned reference protection (spec constraint 1);
  - session advertises the real `maxSizeUpload`; oversized upload → §6.1 problem details;
  - `ContactCard/set` `media` accepts envelope-uploaded blobIds without breaking `POST/GET /contacts/blobs`;
  - EventSource stays 501.
- **Verify with:** `JmapBlobsTest` round-trip + GC tests; `composer done-gate`; OpenAPI updated.
- **Parallel with:** contacts envelope.

## Test plan

- [ ] Upload → download round-trip incl. auth/account scoping, size limit, expiry
- [ ] Reference-protected GC (referenced survives, unreferenced expires; dangling reference → SetError)
- [ ] Dedup-or-not behavior pinned (spec §Edge cases)
- [ ] `composer done-gate`
