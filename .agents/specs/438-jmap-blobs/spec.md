Source: #438 (body-hash: 359bbf09). Parent epic: #435. Umbrella roadmap with sequencing and shared constraints: [../000-jmap-envelope-multidomain/](../000-jmap-envelope-multidomain/spec.md).

# JMAP blobs: real RFC 8620 §6 upload/download

Replace the envelope's blob stubs with a real blob store. Shared infrastructure chunk: prerequisite for the files envelope (every FileNode's content is a blob), the mail envelope (bodies, attachments, drafts), and the final form of contacts photo `media` blobIds. **Status: draft, planning-only.**

## What exists today

`JmapStubController` returns 501 for `GET /jmap/download/{accountId}/{blobId}/{name}`, `POST /jmap/upload/{accountId}`, and the EventSource route; the session honestly advertises `maxSizeUpload: 0`. Contacts REST has its own separate blob store (`ContactBlobService`, `ContactMediaBlobResolver`, `POST/GET /contacts/blobs`) with shipped consumers.

## Goal

RFC 8620 §6-conformant upload and download endpoints backed by a blob table (id, account, sha-256, size, type, expiry) and Flysystem-backed content storage, plus an unreferenced-blob GC that is safe for domain-owned references.

## Non-goals

- Push/EventSource — stays 501 (umbrella non-goal).
- RFC 9404 Blob Management extension methods (`Blob/upload` in-band, `Blob/lookup`) — core §6 only.
- Breaking or migrating the contacts REST blob endpoints — they keep working; the envelope store must interoperate, not replace them in this chunk.

## Technical constraints

1. **Reference-protected GC** — draft-ietf-jmap-filenode-14 requires that a blob referenced by a live FileNode is never expired or garbage-collected. The GC design must support domain-owned references (reference-count or referencing-table check) **from day one**; retrofitting under filenode is the expensive path. Contact cards referencing a blob get the same protection.
2. **Two blob stores** — decide the relationship to `ContactBlobService`: generalize it into the envelope store, or keep both with the envelope store authoritative for envelope-issued blobIds. Either way `ContactCard/set` `media` must accept envelope-uploaded blobIds and REST consumers must not break.
3. **Honest limits** — session `maxSizeUpload` goes from `0` to the real enforced value; oversized uploads get the RFC 8620 §6.1 problem-details error, not a generic 413.
4. **Account scoping** — download/upload are per-account (`{accountId}` path segments); cross-account access is `notFound`, mirroring the dispatcher's `accountNotFound` discipline.

## Edge cases to pin in tests

- Upload → reference from a domain object → GC run: blob survives; unreferenced upload past expiry: blob is gone, download → 404, dangling reference attempt → `invalidProperties`/`blobNotFound`.
- Upload identical content twice: either dedup (same sha-256) or two ids — pick one and pin it.
- Download with wrong `accountId` → `notFound` (no existence leak).
- `type` query parameter and `name` path segment reflected in download response headers per §6.2.

## Verification

Round-trip + GC-protection feature tests (`JmapBlobsTest`); `composer done-gate`; OpenAPI schemas for the two endpoints replace the 501 stubs. Full plan: [plan.md](./plan.md).
