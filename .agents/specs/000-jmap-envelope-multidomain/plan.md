# JMAP envelope: multi-domain expansion — plan (draft)

Derived from [spec.md](./spec.md). **Status: draft, planning-only** — no chunk starts until its issue is filed ([issue-drafts.md](./issue-drafts.md)) and, for `feat/` branches, its own spec folder exists. This folder is the roadmap, not a build order to execute in one run.

## Dependencies

1. Chunk P before any new domain (it removes the calendar couplings the domains would otherwise re-hardcode).
2. Chunk C (contacts) after P; may run parallel with B.
3. Chunk B (blobs) after P; prerequisite for F and M1, and for contacts photo blobIds (C ships a documented deviation until B lands).
4. Chunk T-rest before chunk T-envelope; T-envelope also needs P.
5. Chunk F0 (design) before chunk F; F also needs B.
6. Chunk M0 (design) before M1; M1 also needs B; M2 after M1. M1/M2 start only if M0's recommendation is "build".

## Chunks

### Chunk P: envelope decoupling (prep refactor)

- **Branch:** `refactor/jmap-envelope-decouple` (no spec required; this plan is the reference)
- **Skill:** api
- Move `/jmap*` routes out of the `wgw.calendars` group to `wgw.auth` + `wgw.role:user`.
- Derive `JmapApiController`'s supported-capability set from registered methods; make session capabilities/`accountCapabilities`/`primaryAccounts` pluggable per domain; feature-gated domains drop out of both (session + `using`).
- Derive session `state` from the enabled capability set (spec constraint 4).
- **Done when:** all existing `tests/Feature/Jmap/*` green unchanged; new test pins `unknownCapability` for a gated-off domain; `composer done-gate`.
- **Parallel with:** T-rest, F0, M0.

### Chunk C: contacts envelope (RFC 9610)

- **Branch:** `feat/jmap-envelope-contacts` — file Task, spec folder `<N>-jmap-envelope-contacts`
- **Skill:** api
- `addressbookSyncTokens()` primitive (analog of `CalendarEventRepository::calendarSyncTokens()`); `AddressBook/get|changes|set`, `ContactCard/get|changes|set|query` (+ `queryChanges` → `cannotCalculateChanges`, matching calendars) behind `urn:ietf:params:jmap:contacts`, wrapping the existing `AddressBookRepository` / `ContactCardRepository` / `ContactCardSetService`; legacy REST shapes normalized in the adapters (mirroring `CalendarEventSetMethod`).
- Contact photo `blobId`s resolve against the existing `ContactBlobService` REST blob store, with the deviation documented until chunk B lands (then wired to envelope blobs).
- **Done when:** lifecycle contract test mirrors `JmapClientContractTest` incl. incremental post-write sync; mixed-domain batch test (`Calendar/get` + `ContactCard/get`, states don't bleed); done gate; docs (`jmap-envelope.md` gains the contacts dispatch rows).
- **Parallel with:** B (coordinate on session capability providers from P).

### Chunk B: real blob infrastructure (RFC 8620 §6)

- **Branch:** `feat/jmap-blobs` — file Task, spec folder `<N>-jmap-blobs`
- **Skill:** api
- Replace `JmapStubController` upload/download 501s with real implementations: blob table (id, account, sha-256, size, type, expiry) + Flysystem-backed storage; unreferenced-blob GC with domain-owned reference checks (spec constraint 8 — filenode forbids expiring referenced blobs); raise `maxSizeUpload` to an honest value.
- Wire contacts media to accept envelope-uploaded blobIds (supersedes the chunk C deviation); decide the relationship to the existing `ContactBlobService` store (generalize vs adapt) without breaking REST consumers.
- EventSource push stays a 501 non-goal.
- **Done when:** upload → download round-trip feature tests incl. auth/account scoping, size limits, expiry, and reference-protected GC; session advertises real `maxSizeUpload`; done gate.
- **Parallel with:** C.

### Chunk T-rest: tasks REST sync primitives

- **Branch:** `feat/tasks-item-sync` — file Task under #158/#137 lineage
- **Skill:** api
- Task item `/changes` + `/set` on the existing pattern (`jmap_calendar_event_states` analog or shared table for VTODO), exactly like #429 did for calendar events.
- **Done when:** parity with calendar event sync tests; parity-gaps doc updated.
- **Parallel with:** P, C, B (different service area).

### Chunk T-envelope: tasks envelope (draft-ietf-jmap-tasks-06, expired — pinned)

- **Branch:** `feat/jmap-envelope-tasks` — file Task, spec folder `<N>-jmap-envelope-tasks`
- **Skill:** api
- `TaskList/get|changes|set`, `Task/get|changes|set|query` behind `urn:ietf:params:jmap:tasks` (already advertised by `TasksCapabilitiesService` on REST), wrapping T-rest primitives.
- Pin `draft-ietf-jmap-tasks-06` in docs and converter tests; record the expired-draft deviation risk (spec §External spec status).
- **Done when:** same lifecycle contract test shape; done gate; docs.
- **Parallel with:** F, M1 (after its prerequisites).

### Chunk F0: filenode node-identity design (no code)

- **Deliverable:** short design doc (this spec folder or `packages/api/docs/files/`) resolving spec constraint 10: node-id index table schema (id, parent id, name, blobId/size, timestamps, per-account change counter), how REST drive and WebDAV write paths maintain it (event hooks vs wrapping the Flysystem adapter), backfill strategy for existing trees, and the `FileNode/changes` semantics it yields.
- **Skill:** plan-feature, api
- **Done when:** maintainer review of the design doc; chunk F's Task issue derives its AC from it.
- **Parallel with:** P, T-rest, M0.

### Chunk F: files envelope (draft-ietf-jmap-filenode-14, pinned)

- **Branch:** `feat/jmap-envelope-filenode` — file Task, spec folder `<N>-jmap-envelope-filenode`
- **Skill:** api
- `jmap_file_nodes` index per F0; `FileNode/get|changes|set|copy|query` (+ `queryChanges` → `cannotCalculateChanges`) behind `urn:ietf:params:jmap:filenode`; `onExists` (null/`replace`/`rename`/`newest`) + `onDestroyRemoveChildren` + `alreadyExists` SetError with `existingId` per draft-14; `myRights` derived from drive shares with inheritance; `shareWith` writes deferred; `webWriteUrlTemplate: null`.
- **Done when:** lifecycle contract test (mkdir → upload blob → create file node → rename/move → changes → destroy); rename/move id-stability test; WebDAV-side write reflected in `FileNode/changes`; done gate; docs.
- **Parallel with:** T-envelope, M1.

### Chunk M0: mail state-model design (no code)

- **Deliverable:** decision doc (`docs/product/` or epic body) upgrading the earlier assessment into a build design: required RFC 8621 surface per phase, state model over IMAP (QRESYNC/CONDSTORE modseq vs local sync-cache table, incl. `UIDVALIDITY` invalidation), threading strategy, shared-hosting constraints (ext-imap optionality, no long-lived connections), blob needs, and a build/defer/reject recommendation with explicit phase-1 scope cuts.
- **Skill:** plan-feature, api
- **Done when:** maintainer review; if "build", M1's Task issue derives its AC from it.
- **Parallel with:** P, T-rest, F0.

### Chunk M1: mail envelope, read-only (RFC 8621 subset)

- **Branch:** `feat/jmap-envelope-mail-read` — file Task, spec folder `<N>-jmap-envelope-mail`
- **Skill:** api
- `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get` behind `urn:ietf:params:jmap:mail`, over `MailImapClient`/`MailOperationService`; blob download for bodies/attachments (chunk B); mail-specific state codec per M0 (`cannotCalculateChanges` on `UIDVALIDITY` change).
- **Done when:** lifecycle contract test against the dev IMAP fixture; mixed-domain batch test; done gate; docs.
- **Parallel with:** T-envelope, F.

### Chunk M2: mail writes + submission

- **Branch:** `feat/jmap-envelope-mail-write`
- **Skill:** api
- `Email/set` (flags, mailbox move, destroy, drafts via blob upload), `Identity/get`, `EmailSubmission/set` over the existing SMTP transport (`MailSmtpTransportConfig`, `MailFromAddressResolver`).
- **Done when:** write-then-sync incremental path pinned; submission feature test; done gate; docs.
- **Parallel with:** none (after M1).

## Test plan

Transport tests stay in `JmapDispatcherTest` (chunk P adds the gated-capability case). Each domain chunk ships its own `Jmap<Domain>MethodsTest` + a lifecycle contract test modeled on `JmapClientContractTest`, plus the mixed-domain batch case from spec §Edge cases. Chunk B adds blob round-trip + GC-protection tests. Full `composer done-gate` per chunk; live-client e2e per `docs/calendars/jmap-client-e2e.md` where a real client exists.

## Doc updates

Per chunk: `packages/api/docs/calendars/jmap-envelope.md` grows into (or is joined by) per-domain envelope docs; `packages/api/docs/jmap-rest-parity-gaps.md` envelope section updated as domains land; OpenAPI `openapi/schemas/jmap/*` extended per domain.
