# Task issue drafts — M0 filed; file M1/M2 only if #440 concludes "build"

**Filed:** design doc M0 = **#440** (2026-08-13). **Remaining:** M1 and M2
below — file M1 via `.github/ISSUE_TEMPLATE/task.yml` only on a "build"
outcome of #440, M2 only after M1 lands. Then:

1. `git mv .agents/specs/000-jmap-envelope-mail .agents/specs/<N>-jmap-envelope-mail` (the M1 Task's number)
2. Set `Source: #<N> (body-hash: <first 8 hex of: gh issue view <N> --json body --jq .body | shasum -a 256>)` in [spec.md](./spec.md)
3. Delete this file.

Goal lineage: mail offline/hybrid work groups under Goal #400; eng parity tracker #401.

---

## 1. Task — mail envelope, read-only (chunk M1; file only if #440 = build)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` + `area:mail` · **Parent:** epic #435 · **Branch:** `feat/jmap-envelope-mail-read`

### Title

```
feat(api): JMAP Mail envelope, read-only (Mailbox/Email/Thread)
```

### Body

```markdown
Parent: #435
Depends on: #440 (design, recommendation: build), #438 (blobs)

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

## 2. Task — mail writes + submission (chunk M2; file only after M1)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` + `area:mail` · **Parent:** epic #435 · **Branch:** `feat/jmap-envelope-mail-write`

### Title

```
feat(api): JMAP Mail envelope writes and submission (Email/set, EmailSubmission)
```

### Body

```markdown
Parent: #435
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
