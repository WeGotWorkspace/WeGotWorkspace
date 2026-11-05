# Task issue draft — M2 only (file after M1 lands)

**Filed:** M0 = **#440** (merged, recommendation: build), M1 = **#452**
(blocked by IMAP CI fixture **#451**). **Remaining:** M2 below — file it via
`.github/ISSUE_TEMPLATE/task.yml` only after #452 lands, then delete this
file (the folder is already numbered to M1's issue).

Goal lineage: mail offline/hybrid work groups under Goal #400; eng parity tracker #401.

---

## Task — mail writes + submission (chunk M2; file only after M1)

**Template:** `.github/ISSUE_TEMPLATE/task.yml` · **Label:** `type:task` + `area:mail` · **Parent:** epic #435 · **Branch:** `feat/jmap-envelope-mail-write`

### Title

```
feat(api): JMAP Mail envelope writes and submission (Email/set, EmailSubmission)
```

### Body

```markdown
Parent: #435
Depends on: #452 (M1)

Phase 2 of RFC 8621: mutations and sending.

Spec: `.agents/specs/<N>-jmap-envelope-mail/`

### Acceptance criteria

- [ ] `Email/set` for flags, mailbox move, destroy, and draft creation via uploaded blobs
- [ ] `Identity/get` from principal identity (`MailPrincipalIdentityService`, `MailFromAddressResolver`)
- [ ] `EmailSubmission/set` over the existing SMTP transport (`MailSmtpTransportConfig`)
- [ ] Write-then-sync takes the incremental `/changes` path (regression pinned, mirroring the calendars mismatch-13 lesson)
- [ ] Feature tests incl. submission; OpenAPI + docs; `composer done-gate`
```
