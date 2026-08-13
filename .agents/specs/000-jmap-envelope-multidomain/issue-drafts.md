# Issue drafts — file manually, then renumber spec folders

Issue creation is unavailable from the build environment (`gh` is read-only
there), so these must be filed by a maintainer. Afterwards, per chunk that
gets a `feat/` branch:

1. Create the chunk's spec folder (`git mv` this folder's content or derive a
   fresh `spec.md`) as `.agents/specs/<N>-<slug>/`.
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)`.
3. Update the status column in [tasks.md](./tasks.md).

Filing order matters only for parenting: file the Epic first, then reference
it as `Parent:` in each Task/Chore. Per [issue-filing.md](../../skills/developer/issue-filing.md),
the Epic requires a parent **Goal** — pick the appropriate existing Goal
(offline/suite goals such as #385/#400/#402/#403 cover parts of this; mail
chunks fit #400) or file a new one; Epics/Tasks never go on the Product Project.

---

## 1. Epic — JMAP multi-domain transport envelope

**Template:** `.github/ISSUE_TEMPLATE/epic.yml` · **Label:** `type:epic` · **Parent:** Goal (maintainer picks, see above)

### Title

```
feat(api): JMAP transport envelope for contacts, blobs, tasks, files, and mail
```

### Body

```markdown
Parent: #<goal>

Extend the RFC 8620 JMAP envelope shipped for calendars (#430) to every other
JMAP-shaped domain, so `/api/v1/jmap` becomes the single protocol front:
contacts (RFC 9610), real blob upload/download (RFC 8620 §6), tasks
(draft-ietf-jmap-tasks-06, pinned), files (draft-ietf-jmap-filenode-14,
pinned), and mail (RFC 8621, phased behind a design gate).

Roadmap: `.agents/specs/000-jmap-envelope-multidomain/` (spec.md / plan.md /
tasks.md). Non-goals across all children: JMAP Push, RFC 9670 sharing writes,
changing REST endpoints or their legacy shapes, frontend work.

### Children (sequenced)

- [ ] Chore: envelope decoupling (routes + capability derivation)
- [ ] Task: contacts envelope (RFC 9610)
- [ ] Task: real blob infrastructure (RFC 8620 §6)
- [ ] Task: tasks REST item sync primitives
- [ ] Task: tasks envelope (draft-06 pinned)
- [ ] Task: filenode node-identity design doc
- [ ] Task: files envelope (draft-filenode-14 pinned)
- [ ] Task: mail state-model design doc (build/defer/reject gate)
- [ ] Task: mail envelope read-only (if M0 = build)
- [ ] Task: mail writes + submission (if M0 = build)
```

---

## 2. Chore — envelope decoupling (chunk P)

**Template:** `.github/ISSUE_TEMPLATE/chore.yml` · **Label:** `type:chore` · **Parent:** the Epic above · **Branch:** `refactor/jmap-envelope-decouple`

### Title

```
refactor(api): decouple JMAP envelope routes and capabilities from calendars
```

### Body

```markdown
Parent: #<epic>

The `/jmap*` routes live inside the `wgw.calendars` middleware group and the
supported-capability set is hardcoded in three places
(`JmapApiController::handle()`, `JmapSessionController`, `JmapCapabilities`).
Every new envelope domain would re-hardcode these — remove the coupling first.

### Acceptance criteria

- [ ] `/jmap*` routes moved to a domain-neutral group (`wgw.auth` + `wgw.role:user`)
- [ ] Supported `using` set derived from registered methods' `capability()`
- [ ] Session `capabilities` / `accountCapabilities` / `primaryAccounts` pluggable per domain; feature-gated-off domains omitted from the session and rejected in `using` with `unknownCapability` (test pinned)
- [ ] Session `state` derived from the enabled capability set (no longer a global constant once capabilities can differ per account)
- [ ] All existing `tests/Feature/Jmap/*` green unchanged; `composer done-gate`
```

---

## 3. Task — contacts envelope (chunk C)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-envelope-contacts` · **Spec folder:** `<N>-jmap-envelope-contacts`

### Title

```
feat(api): JMAP envelope methods for contacts (RFC 9610)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<chore P>

Add `AddressBook/*` and `ContactCard/*` to the JMAP envelope behind
`urn:ietf:params:jmap:contacts`, wrapping the existing contacts services
(`AddressBookRepository`, `ContactCardRepository`, `ContactCardSetService`,
`JmapContactStateService`) — same additive-adapter pattern as calendars (#430).

### Acceptance criteria

- [ ] `addressbookSyncTokens()` primitive (analog of `CalendarEventRepository::calendarSyncTokens()`) feeding `JmapAccountStateCodec`
- [ ] `AddressBook/get|changes|set` and `ContactCard/get|changes|set|query` dispatched; `ContactCard/queryChanges` → `cannotCalculateChanges`
- [ ] Envelope adapters normalize the legacy REST shapes (string-valued `created`/`updated`, snake_case SetError types) to RFC 8620; REST endpoints untouched
- [ ] Top-level `ifInState` on `ContactCard/set` (account-wide codec states), mirroring `CalendarEventSetMethod`
- [ ] Contact photo `media` blobIds resolve against the existing `ContactBlobService` store; deviation documented until real envelope blobs land
- [ ] Lifecycle contract test mirroring `JmapClientContractTest` incl. incremental post-write sync; mixed-domain batch test (`Calendar/get` + `ContactCard/get`, states don't bleed)
- [ ] Session advertises `urn:ietf:params:jmap:contacts` (RFC 9610 capability object); OpenAPI + `jmap-envelope.md` updated; `composer done-gate`
```

---

## 4. Task — real blob infrastructure (chunk B)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-blobs` · **Spec folder:** `<N>-jmap-blobs`

### Title

```
feat(api): real JMAP blob upload/download (RFC 8620 §6)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<chore P>

Replace the `JmapStubController` 501 stubs with real RFC 8620 §6 blob
upload/download. Shared prerequisite for filenode content, mail
bodies/attachments, and contacts photo blobIds.

### Acceptance criteria

- [ ] `POST /jmap/upload/{accountId}` stores a blob (table: id, account, sha-256, size, type, expiry; Flysystem-backed content) and returns the RFC 8620 §6.1 response
- [ ] `GET /jmap/download/{accountId}/{blobId}/{name}` streams it back with account scoping enforced
- [ ] Unreferenced-blob GC with domain-owned reference protection (a blob referenced by a contact card — later a FileNode — is never expired; draft-filenode-14 hard requirement)
- [ ] Session advertises an honest non-zero `maxSizeUpload`; upload size limit enforced with the RFC error shape
- [ ] Contacts `media` accepts envelope-uploaded blobIds (supersedes the chunk-C deviation) without breaking `POST/GET /contacts/blobs` REST consumers
- [ ] EventSource stays 501 (push remains a non-goal)
- [ ] Round-trip + GC-protection feature tests; OpenAPI updated; `composer done-gate`
```

---

## 5. Task — tasks REST item sync primitives (chunk T-rest)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above (lineage: #158/#137) · **Branch:** `feat/tasks-item-sync`

### Title

```
feat(api): task item /changes and /set REST sync primitives
```

### Body

```markdown
Parent: #<epic>

Task items still lack the `/changes` + `/set` sync primitives that calendar
events gained in #429 (see parity-gaps platform row). Land them on the same
pattern so the tasks envelope can wrap them.

### Acceptance criteria

- [ ] `GET /tasks/items/changes` per task list (Sabre synctoken-based), same semantics as calendar event `/changes`
- [ ] `POST /tasks/items/set` with per-record `ifInState` → `stateMismatch`, same semantics as calendar event `/set`
- [ ] Per-item state tokens recorded (analog of `jmap_calendar_event_states` or shared table), surviving destroys for `/changes` expansion
- [ ] Test parity with the calendar event sync suites; parity-gaps doc updated; `composer done-gate`
```

---

## 6. Task — tasks envelope (chunk T-envelope)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-envelope-tasks` · **Spec folder:** `<N>-jmap-envelope-tasks`

### Title

```
feat(api): JMAP envelope methods for tasks (draft-ietf-jmap-tasks-06, pinned)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<chore P>, #<task T-rest>

Add `TaskList/*` and `Task/*` to the JMAP envelope behind
`urn:ietf:params:jmap:tasks` (already advertised by `TasksCapabilitiesService`
on REST), wrapping the T-rest primitives.

Note: the tasks spec is an **expired** IETF draft (last revision 2023-03-10).
We control both ends, so we pin `-06` and own the drift risk.

### Acceptance criteria

- [ ] `TaskList/get|changes|set` and `Task/get|changes|set|query` dispatched; `Task/queryChanges` → `cannotCalculateChanges`
- [ ] Legacy REST shapes normalized in adapters (incl. the legacy RecurrenceRule wire types noted in parity-gaps); REST untouched
- [ ] Top-level `ifInState` on `Task/set` with account-wide codec states
- [ ] `draft-ietf-jmap-tasks-06` pinned in docs and converter tests; deviation risk recorded
- [ ] Lifecycle contract test; mixed-domain batch test; OpenAPI + docs; `composer done-gate`
```

---

## 7. Task — filenode node-identity design doc (chunk F0)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Deliverable:** design doc, no code

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

### Acceptance criteria

- [ ] Node-id index schema decided (id, parent id, name, blobId/size, timestamps, per-account change counter) incl. how it powers `FileNode/changes`
- [ ] Maintenance strategy for BOTH write paths (REST drive and WebDAV): event hooks vs wrapping the Flysystem adapter — with failure-mode analysis (index drift)
- [ ] Backfill strategy for existing trees
- [ ] Mapping from drive shares to inherited `myRights` sketched; `shareWith` writes declared out of scope
- [ ] Maintainer review; chunk F Task derives its AC from this doc
```

---

## 8. Task — files envelope (chunk F)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-envelope-filenode` · **Spec folder:** `<N>-jmap-envelope-filenode`

### Title

```
feat(api): JMAP envelope methods for files (draft-ietf-jmap-filenode-14, pinned)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task F0 design>, #<task blobs B>

Expose the drive as JMAP FileNodes behind `urn:ietf:params:jmap:filenode`,
per the F0 design.

### Acceptance criteria

- [ ] `jmap_file_nodes` index (per F0) maintained by REST drive and WebDAV write paths; backfill in place
- [ ] `FileNode/get|changes|set|copy|query` dispatched; `FileNode/queryChanges` → `cannotCalculateChanges`
- [ ] `onExists` (null/`replace`/`rename`/`newest`), `onDestroyRemoveChildren`, and `alreadyExists` SetError with `existingId` per draft-14
- [ ] Rename/move keeps the node id stable and yields exactly one `updated` entry in `FileNode/changes`; a WebDAV-side write is visible in `FileNode/changes`
- [ ] `myRights` derived from drive shares with tree inheritance; `shareWith` writes deferred; `webWriteUrlTemplate: null`
- [ ] Blob-content lifecycle: create file node from uploaded blob; referenced blobs protected from GC
- [ ] `draft-ietf-jmap-filenode-14` pinned in docs/tests; lifecycle contract test; OpenAPI + docs; `composer done-gate`
```

---

## 9. Task — mail state-model design doc (chunk M0)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above (Goal lineage: #400) · **Deliverable:** decision doc, no code

### Title

```
docs(api): JMAP Mail (RFC 8621) over IMAP — state model and build/defer decision
```

### Body

```markdown
Parent: #<epic>

Mail is the one domain on a non-Sabre substrate (IMAP/SMTP,
`app/Services/Mail/*`); the synctoken-based `JmapAccountStateCodec` does not
apply. Produce the design + decision doc gating any mail envelope build.

### Acceptance criteria

- [ ] Required RFC 8621 surface mapped per phase (read-only vs writes vs submission), with explicit phase-1 scope cuts
- [ ] State model decided: QRESYNC/CONDSTORE modseq vs local sync-cache table, incl. `UIDVALIDITY` invalidation → `cannotCalculateChanges` semantics
- [ ] Threading strategy decided (`Thread/get`, `threadId` derivation)
- [ ] Shared-hosting constraints assessed (ext-imap optionality, no long-lived connections, per-request IMAP session cost)
- [ ] Blob requirements enumerated against chunk B (bodies, attachments, drafts)
- [ ] Build / defer / reject recommendation; maintainer review; if "build", M1's Task derives its AC from this doc
```

---

## 10. Task — mail envelope, read-only (chunk M1; file only if M0 = build)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-envelope-mail-read` · **Spec folder:** `<N>-jmap-envelope-mail`

### Title

```
feat(api): JMAP Mail envelope, read-only (Mailbox/Email/Thread)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task M0 design> (recommendation: build), #<task blobs B>

Phase 1 of RFC 8621 per the M0 design: read-only mail behind
`urn:ietf:params:jmap:mail`.

### Acceptance criteria

- [ ] `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get` dispatched over `MailImapClient`/`MailOperationService`
- [ ] Mail-specific state codec per M0; `UIDVALIDITY` change → `cannotCalculateChanges` (test pinned)
- [ ] Body/attachment download via envelope blobs
- [ ] Lifecycle contract test against the dev IMAP fixture; mixed-domain batch test; OpenAPI + docs; `composer done-gate`
```

---

## 11. Task — mail writes + submission (chunk M2; file only after M1)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the Epic above · **Branch:** `feat/jmap-envelope-mail-write`

### Title

```
feat(api): JMAP Mail envelope writes and submission (Email/set, EmailSubmission)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task M1>

Phase 2 of RFC 8621: mutations and sending.

### Acceptance criteria

- [ ] `Email/set` for flags, mailbox move, destroy, and draft creation via uploaded blobs
- [ ] `Identity/get` from principal identity (`MailPrincipalIdentityService`, `MailFromAddressResolver`)
- [ ] `EmailSubmission/set` over the existing SMTP transport (`MailSmtpTransportConfig`)
- [ ] Write-then-sync takes the incremental `/changes` path (regression pinned, mirroring the calendars mismatch-13 lesson)
- [ ] Feature tests incl. submission; OpenAPI + docs; `composer done-gate`
```
