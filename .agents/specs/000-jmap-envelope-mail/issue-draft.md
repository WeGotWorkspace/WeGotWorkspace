# Task issue drafts — file manually, then renumber this folder

File M0 via `.github/ISSUE_TEMPLATE/task.yml` now; file M1/M2 **only if** the
M0 doc concludes "build". Then:

1. `git mv .agents/specs/000-jmap-envelope-mail .agents/specs/<N>-jmap-envelope-mail` (use the **M1** Task's number)
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

Goal lineage: mail offline/hybrid work groups under Goal #400.

---

## 1. Task — mail state-model design doc (chunk M0)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic ([../000-jmap-envelope-multidomain/issue-drafts.md](../000-jmap-envelope-multidomain/issue-drafts.md)) · **Deliverable:** decision doc, no code

### Title

```
docs(api): JMAP Mail (RFC 8621) over IMAP — state model and build/defer decision
```

### Body

```markdown
Parent: #<epic>

Mail is the one envelope domain on a non-Sabre substrate (IMAP/SMTP,
`app/Services/Mail/*`); the synctoken-based `JmapAccountStateCodec` does not
apply. Produce the design + decision doc gating any mail envelope build.

Spec: `.agents/specs/<N>-jmap-envelope-mail/`

### Acceptance criteria

- [ ] Required RFC 8621 surface mapped per phase (read-only vs writes vs submission), with explicit phase-1 scope cuts
- [ ] State model decided: QRESYNC/CONDSTORE modseq vs local sync-cache table, incl. `UIDVALIDITY` invalidation → `cannotCalculateChanges` semantics
- [ ] Threading strategy decided (`Thread/get`, `threadId` derivation)
- [ ] Shared-hosting constraints assessed (ext-imap optionality, no long-lived connections, per-request IMAP session cost)
- [ ] Blob requirements enumerated against the blobs chunk (bodies, attachments, drafts)
- [ ] Build / defer / reject recommendation; maintainer review; if "build", the M1 Task derives its AC from this doc
```

---

## 2. Task — mail envelope, read-only (chunk M1; file only if M0 = build)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic · **Branch:** `feat/jmap-envelope-mail-read`

### Title

```
feat(api): JMAP Mail envelope, read-only (Mailbox/Email/Thread)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task M0 design> (recommendation: build), #<task blobs>

Phase 1 of RFC 8621 per the M0 design: read-only mail behind
`urn:ietf:params:jmap:mail`.

Spec: `.agents/specs/<N>-jmap-envelope-mail/`

### Acceptance criteria

- [ ] `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get` dispatched over `MailImapClient`/`MailOperationService`
- [ ] Mail-specific state codec per M0; `UIDVALIDITY` change → `cannotCalculateChanges` (test pinned)
- [ ] Body/attachment download via envelope blobs
- [ ] One IMAP session per batch request (no per-method connection fan-out)
- [ ] Lifecycle contract test against the dev IMAP fixture; mixed-domain batch test; OpenAPI + docs; `composer done-gate`
```

---

## 3. Task — mail writes + submission (chunk M2; file only after M1)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` · **Parent:** the multi-domain envelope Epic · **Branch:** `feat/jmap-envelope-mail-write`

### Title

```
feat(api): JMAP Mail envelope writes and submission (Email/set, EmailSubmission)
```

### Body

```markdown
Parent: #<epic>
Depends on: #<task M1>

Phase 2 of RFC 8621: mutations and sending.

Spec: `.agents/specs/<N>-jmap-envelope-mail/`

### Acceptance criteria

- [ ] `Email/set` for flags, mailbox move, destroy, and draft creation via uploaded blobs
- [ ] `Identity/get` from principal identity (`MailPrincipalIdentityService`, `MailFromAddressResolver`)
- [ ] `EmailSubmission/set` over the existing SMTP transport (`MailSmtpTransportConfig`)
- [ ] Write-then-sync takes the incremental `/changes` path (regression pinned, mirroring the calendars mismatch-13 lesson)
- [ ] Feature tests incl. submission; OpenAPI + docs; `composer done-gate`
```
