# JMAP envelope: mail — plan (draft)

Derived from [spec.md](./spec.md). Umbrella sequencing: [../000-jmap-envelope-multidomain/plan.md](../000-jmap-envelope-multidomain/plan.md).

## Dependencies

1. Chunk M0 (design + decision doc) gates everything; M1/M2 issues are filed only if M0 recommends "build".
2. Chunk M1 needs umbrella chunk P and the blobs chunk ([../000-jmap-blobs/](../000-jmap-blobs/plan.md)).
3. Chunk M2 after M1.
4. M0 itself has no dependencies — can start any time, parallel with P and the filenode design doc.

## Chunks

### Chunk M0: state-model design + build/defer/reject decision (no code)

- **Deliverable:** decision doc (`docs/product/` or the Epic body).
- **Skill:** plan-feature, api
- **Done when:**
  - required RFC 8621 surface mapped per phase, with explicit phase-1 scope cuts;
  - state model decided: QRESYNC/CONDSTORE modseq vs local sync-cache table, incl. `UIDVALIDITY` invalidation → `cannotCalculateChanges` semantics;
  - threading strategy decided (`threadId` derivation, caching);
  - shared-hosting constraints assessed (ext-imap optionality, no long-lived connections, per-request IMAP session budget);
  - blob requirements enumerated against the blobs chunk;
  - build / defer / reject recommendation; maintainer review; if "build", M1's Task derives its AC from this doc.
- **Parallel with:** umbrella chunk P, filenode design doc.

### Chunk M1: read-only mail envelope

- **Branch:** `feat/jmap-envelope-mail-read`
- **Skill:** api
- **Inputs:** M0 doc; `MailImapClient` / `MailOperationService`; blobs chunk.
- **Done when:**
  - `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get` registered behind `urn:ietf:params:jmap:mail`;
  - mail-specific state codec per M0; `UIDVALIDITY` change → `cannotCalculateChanges` (test pinned);
  - body/attachment download via envelope blobs;
  - one IMAP session per batch request (spec §Edge cases);
  - lifecycle contract test against the dev IMAP fixture; mixed-domain batch test.
- **Verify with:** `composer done-gate`; OpenAPI + docs.
- **Parallel with:** filenode build chunk (different service area; both after blobs).

### Chunk M2: writes + submission

- **Branch:** `feat/jmap-envelope-mail-write`
- **Skill:** api
- **Inputs:** M1; SMTP transport (`MailSmtpTransportConfig`, `MailFromAddressResolver`, `MailPrincipalIdentityService`).
- **Done when:**
  - `Email/set` for flags, mailbox move, destroy, drafts via uploaded blobs;
  - `Identity/get` from principal identity; `EmailSubmission/set` over the existing SMTP transport;
  - write-then-sync takes the incremental `/changes` path (regression pinned);
  - submission feature test.
- **Verify with:** `composer done-gate`; OpenAPI + docs.
- **Parallel with:** none (last).

## Test plan

- [ ] M1: `JmapMailMethodsTest` per method; lifecycle contract test vs dev IMAP fixture; `UIDVALIDITY` invalidation case; mixed-domain batch
- [ ] M2: write-then-sync incremental regression; submission test
- [ ] `composer done-gate` per phase
