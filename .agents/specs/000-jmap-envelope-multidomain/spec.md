Source: ad-hoc (draft — file the Epic + Task issues from [issue-drafts.md](./issue-drafts.md) before starting any `feat/` branch; parent under epic #137 or a new envelope epic). Rewritten 2026-08-13 to cover files (FileNode) and a phased mail build; external spec status verified against jmap.io and the IETF datatracker the same day. Tasks removed from the roadmap on maintainer review the same day (spec too immature — see Non-goals).

# JMAP envelope: multi-domain expansion (contacts, blobs, files, mail)

Technical translation for extending the calendars JMAP transport envelope (`.agents/specs/000-jmap-envelope-calendars/`, PR #430) to every other JMAP-shaped domain in `packages/api`. **Status: draft, planning-only** — this folder's deliverable is the reviewed direction; each chunk becomes its own filed issue, spec folder, and `feat/`/`refactor/` branch before any code is written. Re-derive per-chunk specs from the filed Task issues before building.

## Goal

One `/api/v1/jmap` front for every JMAP-backed domain. The envelope machinery from #430 (dispatcher, ResultReferences, argument traits, `JmapAccountStateCodec`, error vocabulary, session skeleton, limits) is already domain-agnostic; this work adds domain method handlers, real blob support, and removes the known calendar couplings. Ordering by substrate readiness and external-spec maturity: decoupling first, contacts next (same Sabre substrate, repositories exist, final RFC), blobs as the shared unlock, files after a node-identity design decision, mail phased behind a design gate.

## External spec status (verified 2026-08-13)

| Domain | Spec | Status | Capability URN |
|--------|------|--------|----------------|
| Core | RFC 8620 | Final | `urn:ietf:params:jmap:core` |
| Calendars | draft-ietf-jmap-calendars-27 | In progress (shipped in #430) | `urn:ietf:params:jmap:calendars` |
| Contacts | **RFC 9610** (JSContact: RFC 9553) | **Final** | `urn:ietf:params:jmap:contacts` |
| Mail | **RFC 8621** | **Final** | `urn:ietf:params:jmap:mail` (+ `:submission`) |
| Tasks | draft-ietf-jmap-tasks-06 | **Expired draft** (last revision 2023-03-10; IESG-submission milestone since slipped to Mar 2027) — **out of scope**, see Non-goals | `urn:ietf:params:jmap:tasks` |
| Files | draft-ietf-jmap-filenode-14 | **Active draft** (2026-05-15, expires 2026-11-16) | `urn:ietf:params:jmap:filenode` |
| Sharing | RFC 9670 | Final (referenced by filenode; not built here) | — |

Implications:

- **Contacts** is spec-stable and closest to done — the REST layer already implements the RFC 9610 object model (`AddressBook`, `ContactCard` over JSContact) and its CardDAV conversion matrix.
- **Tasks** targets an expired draft (last touched 2023) and is judged too immature to build against — it is **excluded from this roadmap** (see Non-goals). The existing JMAP-shaped tasks REST layer stays as-is; revisit when the WG revives the document.
- **Files** targets an active, still-moving draft (draft-14 added `onExists: "newest"` and `caseInsensitiveNames` recently). Pin the draft revision; expect wire-level churn until it goes to the IESG (WG milestone: Jun 2026, slipped).
- **Mail** is a final RFC but a different substrate entirely (see constraints below).

## Non-goals

- **Tasks envelope** — removed from this roadmap (maintainer decision, 2026-08-13): `draft-ietf-jmap-tasks-06` is an expired draft, too immature to justify an envelope next to the shipped REST implementation. The REST-level task item `/changes` + `/set` gap remains tracked independently in `docs/jmap-rest-parity-gaps.md` (#158) and is not part of this plan. Revisit when the WG produces a stable revision.
- JMAP Push (RFC 8620 §7) — clients poll; `eventSourceUrl` stays a 501 stub in every chunk.
- JMAP Sharing writes (RFC 9670 `shareWith`) — stays a read-only mapping (`myRights`) where applicable; consistent with the REST sharing stub.
- Full RFC 8621 in one step — mail is phased (M0 design gate → M1 read-only → M2 writes/submission); each phase is separately reviewable and separately abortable.
- Changing REST endpoints or their legacy response shapes (contacts keeps shipped consumers; normalization happens in envelope adapters, mirroring `CalendarEventSetMethod`).
- `createdIds` maps, PatchObject update payloads — same documented deviations as calendars.
- WebSocket transport (RFC 8887), Quotas (RFC 9425), Blob Management extension (RFC 9404 — the core §6 upload/download is in scope via chunk B; the extension methods are not).
- Frontend/client work — this roadmap is backend-only; apps adoption is planned separately once each domain's envelope exists.

## Affected packages

- packages/api (routes, `app/Services/Jmap/`, `app/Services/Contacts|Mail/`, `app/Dav/Storage/`, OpenAPI, docs) — when the chunks are built. **This planning folder itself changes no code.**

## Technical constraints and known coupling points

1. **Route placement** — `/jmap*` routes currently live inside the calendars middleware group (`wgw.calendars`, `routes/api.php`). Must move to a domain-neutral group (`wgw.auth` + `wgw.role:user`); domain availability is then expressed through advertised capabilities + the `using` guard, not feature-gate middleware. Per-domain behavior when a feature toggle (e.g. `wgw.contacts` off) is disabled: capability absent from the session and `using` rejected with `unknownCapability`.
2. **Hardcoded capability lists** — `JmapApiController::handle()` (`$supported`), `JmapSessionController` (capabilities / `accountCapabilities` / `primaryAccounts`), `JmapCapabilities`. Derive the supported set from registered methods' `capability()`; give the session a per-domain capability-provider list.
3. **Dispatcher registration** — constructor-injected method list is fine at 9 methods; switch to a tagged/config array when contacts pushes it past ~15.
4. **Session state constant** — `JmapCapabilities::SESSION_STATE` is spec-legal only while the session document is identical for every account. Once capabilities can differ per account (feature gates), derive it from the enabled capability set.
5. **Contacts state primitive** — no `addressbookSyncTokens()` analog of `CalendarEventRepository::calendarSyncTokens()` exists yet; the codec itself (`JmapAccountStateCodec`) is already generic over `{uri → token}` maps.
6. **Contacts legacy REST shapes** — string-valued `created`/`updated`, snake_case SetError types (see `docs/jmap-rest-parity-gaps.md`). Envelope methods normalize to RFC 8620 shapes at the adapter layer; REST stays untouched.
7. **Blob endpoints are stubs** — `JmapStubController` returns 501 for download/upload/EventSource and the session honestly advertises `maxSizeUpload: 0`. Contacts photos (RFC 9610 `media` with `blobId`), every FileNode's content, and every mail body/attachment need real RFC 8620 §6 upload/download. Contacts REST already has its own blob store (`ContactBlobService`, `ContactMediaBlobResolver`, `POST/GET /contacts/blobs`); chunk B must either generalize it or supersede it behind the envelope, without breaking the REST consumers.
8. **Blob retention vs GC** — draft-filenode-14 requires that a blob referenced by a live FileNode is never expired or garbage-collected. Chunk B's GC design must support domain-owned references (reference-count or referencing-table check) from day one, or filenode retrofits get ugly.
9. **FileNode identity vs path-addressed storage** — FileNode ids must be stable across rename/move (`name`/`parentId` are mutable properties on a stable id) while the drive is path-addressed Flysystem (`app/Dav/Storage/FlysystemNode.php` and friends; REST `FilesController` + WebDAV both address by path). A durable node-id index (id ↔ current path, parent, name, blobId/size, timestamps, per-account change counter) is required, and **both** write paths (REST drive and WebDAV) must maintain it — this is the only chunk that touches existing write paths rather than purely adding an adapter. `FileNode/changes` falls out of the same index (per-account change counter), since Flysystem has no changelog. Design first (chunk F0), build second (chunk F).
10. **Drive sharing → FileNode rights** — existing drive shares (`DriveSharesController`, share sessions) map onto the draft's inherited `myRights` (8 booleans incl. `mayAddChildren`/`mayRename`/`mayDelete`/`mayModifyContent`); `shareWith` writes stay out of scope (non-goal), `webWriteUrlTemplate` advertised as `null` (clients use `FileNode/set` + blob upload).
11. **Mail is a different substrate** — IMAP-backed (`app/Services/Mail/MailImapClient.php`, `MailOperationService`), not Sabre; SMTP for submission. The Sabre synctoken-based `JmapAccountStateCodec` does not map onto IMAP: mail needs its own state model — per-mailbox `UIDVALIDITY`/`HIGHESTMODSEQ` (QRESYNC/CONDSTORE, when the server supports it) or a local sync-cache table, decided in chunk M0. Shared-hosting constraints apply (no long-lived connections; one-request-one-response only). RFC 8621 additionally needs threading (`Thread/get`, `threadId` on `Email`) and real blobs (bodies, attachments, `Email/set` drafts by blobId).

## Edge cases to pin in tests (per-chunk specs expand these)

- `using` with a capability whose domain feature-gate is disabled → `unknownCapability` (request-level), and the session omits it.
- Mixed-domain batches (e.g. `Calendar/get` + `ContactCard/get` in one request) share one dispatcher pass and per-domain states never bleed into each other's `state` strings.
- Contact photo blobs: an envelope-uploaded blobId must resolve when referenced from `ContactCard/set` `media`; before chunk B, contacts envelope documents the deviation (REST blob store only).
- Blob upload → reference → GC: a blob referenced by a FileNode (or contact card) survives GC; an unreferenced upload expires.
- FileNode rename/move keeps the id stable and reports exactly one `updated` entry in `FileNode/changes`; `onExists` (null / `"replace"` / `"rename"` / `"newest"`) and the `alreadyExists` SetError with `existingId` behave per draft-14.
- Mail `sinceState` from a mailbox whose `UIDVALIDITY` changed → `cannotCalculateChanges` (client refetches), never silently wrong deltas.

## Sequencing summary

```
P (decouple) ─┬─► C  (contacts envelope)
              └─► B  (real blobs) ─┬─► F  (files envelope; F0 design gates F)
                                   └─► M1 (mail read-only) ─► M2 (mail writes + submission)

Independent starts: F0 (filenode design), M0 (mail design; gates M1)
```

Full chunk definitions, dependencies, and done-when criteria: [plan.md](./plan.md). Engineering rows: [tasks.md](./tasks.md). Issue bodies to file: [issue-drafts.md](./issue-drafts.md).
