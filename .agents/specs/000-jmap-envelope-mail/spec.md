Source: ad-hoc (design Task M0 filed as **#440**; M1/M2 are filed **only if** #440 concludes "build" — see [issue-draft.md](./issue-draft.md) — then rename this folder to `<N>-jmap-envelope-mail` with the M1 Task's number and set its body-hash here). Parent epic: #435. Umbrella roadmap with sequencing and shared constraints: [../000-jmap-envelope-multidomain/](../000-jmap-envelope-multidomain/spec.md).

# JMAP envelope: mail (RFC 8621, phased behind a design gate)

Bring mail behind the JMAP envelope with `urn:ietf:params:jmap:mail`. **Status: draft, planning-only.** Three-step and abortable: a design + decision doc (M0) gates a read-only build (M1), which gates writes + submission (M2). M0 may legitimately conclude "defer" or "reject" — that outcome closes this folder without code.

## External spec

**RFC 8621** (final). Full conformance requires `Mailbox`, `Thread`, `Email`, `SearchSnippet`, `Identity`, `EmailSubmission`, `VacationResponse`; this plan phases it and explicitly cuts scope per phase (M0 decides the cuts; `SearchSnippet` and `VacationResponse` are expected phase-3+ candidates, not commitments).

## Why mail is different (the substrate problem)

Every other envelope domain sits on Sabre/PDO in-process; mail is **IMAP-backed** (`app/Services/Mail/MailImapClient.php`, `MailImapProcess`, `MailOperationService`) with SMTP for submission (`MailSmtpTransportConfig`, `MailFromAddressResolver`, `MailPrincipalIdentityService`). Consequences:

1. **The Sabre synctoken codec does not apply.** `JmapAccountStateCodec` composes `{uri → synctoken}` maps; IMAP has no synctokens. Mail needs its own state model: per-mailbox `UIDVALIDITY`/`HIGHESTMODSEQ` (QRESYNC/CONDSTORE, RFC 7162 — only when the IMAP server advertises it) or a local sync-cache table. M0 decides; `UIDVALIDITY` change must yield `cannotCalculateChanges` (client refetches), never silently wrong deltas.
2. **Shared-hosting constraints.** No long-lived connections, one-request-one-response, ext-imap optionality (`ImapExtension`), per-request IMAP session setup cost — an `Email/query` + `Email/get` batch should not open N connections.
3. **Threading is not free.** RFC 8621 requires `threadId` on every Email and `Thread/get`; IMAP has no server-side thread ids — M0 picks the derivation (References/In-Reply-To walk, cached).
4. **Blobs are load-bearing.** Bodies and attachments are blob downloads; drafts are created from uploaded blobs. Hard dependency on the blobs chunk ([../438-jmap-blobs/](../438-jmap-blobs/spec.md)).

## Non-goals

- Push (RFC 8620 §7) — poll only, consistent with the envelope.
- `SearchSnippet`, `VacationResponse`, MDN (RFC 9007), S/MIME (RFC 9219), Sieve (RFC 9661) — not in M1/M2; M0 may nominate them for later phases.
- Replacing the mail REST endpoints (`MailController`, `Services/Mail/*`) — the envelope is additive, as everywhere else.

## Phases

- **M0 — design + decision doc (no code).** State model, threading, connection budget, blob needs, per-phase scope cuts, and a build/defer/reject recommendation. This is the gate: M1/M2 issues are filed only on "build".
- **M1 — read-only.** `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get`; body/attachment download via envelope blobs; mail-specific state codec per M0.
- **M2 — writes + submission.** `Email/set` (flags, mailbox move, destroy, drafts via uploaded blobs), `Identity/get`, `EmailSubmission/set` over the existing SMTP transport.

## Edge cases to pin in tests

- `sinceState` from a mailbox whose `UIDVALIDITY` changed → `cannotCalculateChanges`, client refetch path exercised.
- Mixed-domain batch (`Email/query` + `Calendar/get`): states don't bleed; one IMAP session per request, not per method call.
- Message deleted server-side between `Email/query` and the back-referenced `Email/get` in the same batch → `notFound` entry, not a batch failure.
- Write-then-sync (M2): after `Email/set`, the next `Email/changes` takes the incremental path (the calendars mismatch-13 lesson).

## Verification

Lifecycle contract tests against the dev IMAP fixture; `composer done-gate`; OpenAPI + docs per phase. Full plan: [plan.md](./plan.md).
