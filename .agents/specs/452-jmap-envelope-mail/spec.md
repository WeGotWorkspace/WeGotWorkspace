Source: #786 (body-hash: 2007b1a8). M2: #787 (body-hash: 60ef7912). Parent epic: #401. Design gate #440 delivered (PR #448 — [`packages/api/docs/mail/jmap-mail-decision.md`](../../../packages/api/docs/mail/jmap-mail-decision.md)). IMAP fixture: #785. Per-user servers: #784. Umbrella: [../000-jmap-envelope-multidomain/](../000-jmap-envelope-multidomain/spec.md).

# JMAP envelope: mail (RFC 8621)

Bring mail behind the JMAP envelope with `urn:ietf:params:jmap:mail` (and `urn:ietf:params:jmap:submission` in M2). Delivery is no longer planning-only: M0 decided **build**. This folder is the technical translation of Tasks #786 (M1) and #787 (M2).

## External spec

**RFC 8621** (final). This program ships Mailbox, Thread, Email, Identity, EmailSubmission. `SearchSnippet` and `VacationResponse` stay later.

## Substrate (locked)

- Local sync-cache, not CONDSTORE/QRESYNC (`ext-imap` has no MODSEQ).
- Email / `mb-` ids: `{mailAccountId}:{base64url(mailbox)}:{uidvalidity}:{uid}` (today `mailAccountId=primary`). Mailbox ids omit UIDVALIDITY.
- One IMAP session per mail account per `/jmap` POST; mixed-mailbox batches sequential SELECT/`imap_reopen`. `MailImapProcess` isolation is per-batch when Apache isolate is on.
- `mb-` download streams live `imap_fetchbody` — **no** copy into `jmap_blobs`.
- Threads: cached `thread_key` from References/In-Reply-To (scope cut #2).
- Flag-diff window: most recent 500 UIDs per mailbox (cut #1).
- `Email/query` maps only `imap_search`/`imap_sort` (cut #4).
- IMAP adapter is the permanent OSS path; native Stalwart JMAP is a later RFC.

## Non-goals

- Push, SearchSnippet, VacationResponse, MDN, S/MIME, Sieve
- Dexie / Goal #400
- Thread UI (#398)
- Native Stalwart bypass
- REST sunset (#789) — envelope is additive until the app cutover lands
- Extra `session.accounts` (keep `accountId` = principal username)

## Phases

- **M1 (#786):** `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get`, `mb-` blobs, mail state codec, `MailCapabilityProvider` omit rules
- **M2 (#787):** `Email/set`, `Mailbox/set`, `Identity/get` (list), `EmailSubmission/set` requiring `identityId`, write-then-sync incremental `/changes`

## Edge cases to pin in tests

- `sinceState` from a mailbox whose `UIDVALIDITY` changed → `cannotCalculateChanges`
- Stale-id `Email/get` / `mb-` download (uidvalidity mismatch) → `notFound`, never the wrong body
- Mixed-domain batch (`Email/query` + `Calendar/get`): states don't bleed; one IMAP session per mail account
- Mixed-mailbox batch (INBOX then Sent): sequential SELECT on that session
- Message deleted between `Email/query` and back-referenced `Email/get` → `notFound` entry
- Write-then-sync (M2): after `Email/set`, next `Email/changes` takes the incremental path
- Capability omitted when `mail_enabled` is off **or** this user is not ready **or** no `ext-imap` (distinct reasons)

## Verification

Lifecycle contract tests against the IMAP fixture; `composer done-gate`; OpenAPI + decision-doc notes. Full plan: [plan.md](./plan.md).
