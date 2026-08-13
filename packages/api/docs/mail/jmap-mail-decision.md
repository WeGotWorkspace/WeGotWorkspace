# JMAP Mail over IMAP — state model and build/defer decision (#440)

> **Issue:** [#440](https://github.com/WeGotWorkspace/wegotworkspace/issues/440) · **Epic:** [#435](https://github.com/WeGotWorkspace/wegotworkspace/issues/435) · **Spec folder:** `.agents/specs/452-jmap-envelope-mail/`
> **External spec:** RFC 8621 (final) · **Related goals:** #382 (send/receive, fulfilled), #398 (threads, adopted), #400 (offline mail, adopted), #407 (multi-account) · **Eng tracker:** #401
>
> Decision gate: mail envelope Tasks M1 (read-only) / M2 (writes + submission) are filed **only if** this document's recommendation is "build".

## Recommendation

**Build M1 — with one extra prerequisite and four explicit scope cuts.** The substrate can support an honest RFC 8621 read-only subset, and the sync-cache this design introduces is the same infrastructure the adopted offline-mail Goal (#400) needs anyway — building it behind the envelope does the work once. The prerequisite: **a real IMAP fixture in CI** (see §Testing), because today no mail test exercises a live mailbox and every other envelope domain was verified with lifecycle contract tests. Without that fixture, M1 should not start.

## Substrate facts (verified 2026-08-13)

- **Client:** PHP `ext-imap` (optional; missing → 503 `imap_extension_required`), wrapped by `MailImapClient`. Body parsing via `zbateson/mail-mime-parser`; sending via PHPMailer (`MailSmtpTransportConfig`, `SMTPKeepAlive = false`).
- **No sync primitives in use:** zero occurrences of `UIDVALIDITY`, `UIDNEXT`, `MODSEQ`, `CONDSTORE`, `QRESYNC`, or capability negotiation. `imap_status` is called with `SA_UNSEEN` only. The REST list is offset/limit paging (`{messages, hasMore}`), not state-based.
- **Connection pattern:** connect → operate → close **per REST operation**; under `apache2handler` (or `WGW_IMAP_ISOLATE=1`) each operation additionally forks a CLI subprocess (`MailImapProcess`, 120s timeout).
- **Ids:** `{base64url(mailbox)}:{uid}` — folder + IMAP UID; no account-stable message identity across moves.
- **Threading:** none anywhere (no `threadId`, no References/In-Reply-To grouping).
- **Credentials:** one instance-wide IMAP/SMTP host pair + one credential row per user (`mail_user_credentials`, AES-256-GCM). No OAuth. Multi-account (#407) is out of current schema.
- **Tests:** validation/gate tests only; happy paths assert `503 imap_connect` because nothing listens. Mailhog in `compose.dev.yml` is SMTP-only.

## Decision 1 — state model: local sync-cache table, not CONDSTORE/QRESYNC

QRESYNC/CONDSTORE are **off the table with `ext-imap`**: the extension exposes no MODSEQ APIs at all, and swapping to a pure-PHP IMAP protocol client to get them is a substrate replacement, not an envelope adapter — out of scope and against the roadmap's "wrap existing services" pattern.

What `ext-imap` *does* expose is enough for an honest UIDVALIDITY/UIDNEXT model plus a cache:

New table **`jmap_mail_sync`** (per user × mailbox): `username`, `mailbox`, `uidvalidity`, `last_seen_uidnext`, plus a message-row table **`jmap_mail_messages`** (`username`, `mailbox`, `uid`, `flags_hash`, `message_id_hash`, `thread_key`, `internaldate`) acting as the local mirror of envelope-visible messages.

- **Email/changes(sinceState):** per mailbox — `UIDVALIDITY` changed → `cannotCalculateChanges` (client refetches; pinned in tests, never silently wrong deltas). Otherwise: new UIDs ≥ cached `uidnext` → `created`; cached UIDs missing from the server → `destroyed`; flag diffs (via `imap_fetch_overview` on cached UIDs) → `updated`.
- **Scope cut #1 (flag-diff window):** re-fetching overviews for *every* cached UID is O(mailbox size) per sync. Flag changes are detected only within a **recent window** (the most recent 500 UIDs per mailbox, configurable); older flag flips surface on refetch, not in `/changes`. This is the honest, documented trade-off — same family as `hasMoreChanges: false` on the Sabre domains.
- **State string:** versioned digest of `{mailbox → (uidvalidity, uidnext, window-flags-hash)}` — composed/decomposed by a mail-specific codec (the Sabre `JmapAccountStateCodec` does not apply, as the umbrella spec predicted).
- **Email ids:** keep `{base64url(mailbox)}:{uid}` (a move = destroyed + created, which RFC 8621 permits servers to do; documented deviation from "ids SHOULD survive moves").

## Decision 2 — threading: cached derivation, not IMAP THREAD

RFC 8621 requires `threadId` on every Email and `Thread/get`. `imap_thread()` exists but is per-mailbox and per-connection (threads must span mailboxes) — unusable as-is. Instead: at cache-fill time, derive **`thread_key` = hash of the normalized root of the References/In-Reply-To chain** (falling back to normalized subject + participants when headers are absent), stored on `jmap_mail_messages`. `Thread/get` answers **from the cache only**. **Scope cut #2:** threads are only as complete as the cache window; cross-mailbox thread membership converges as mailboxes are synced. This directly serves Goal #398.

## Decision 3 — connection budget: one IMAP session per batch, isolation per batch

A JMAP batch (`Email/query` + `Email/get` + `Mailbox/get` in one POST) must not open N connections. Design: `MailImapClient` gains a request-scoped session (open lazily on the first mail method, `imap_reopen` to switch mailboxes, close at request end). **The `MailImapProcess` isolation boundary moves from per-operation to per-batch** — under Apache, one fork per `/jmap` POST instead of one per method call. **Scope cut #3:** no cross-request pooling; shared hosting keeps one-request-one-response.

## Decision 4 — blobs: stream, don't copy

- **Bodies/attachments (M1):** download ids `mb-{base64url(mailbox)}:{uid}:{section}` served by the existing `/jmap/download` endpoint via a mail resolver that streams live from IMAP (`imap_fetchbody`). Nothing is copied into `jmap_blobs`; no GC involvement.
- **Drafts/submission (M2):** client uploads via `POST /jmap/upload` (#438), `Email/set` create + `EmailSubmission/set` consume the `jb-` blob (`imap_append` / SMTP) and the upload expires naturally — the contacts/filenode copy-on-consume pattern; **no reference checker needed**.

## Phasing and scope cuts (summary)

| Phase | Surface | Explicitly cut |
|-------|---------|----------------|
| **M1** (read-only) | `Mailbox/get|changes`, `Email/get|query|changes`, `Thread/get`, blob download | flag-diff window (cut #1); cache-bounded threads (cut #2); no pooling (cut #3); **cut #4:** `Email/query` maps only what `imap_search`/`imap_sort` support (text, unseen, flagged, date sort) — everything else `unsupportedFilter`/`unsupportedSort`, the contacts precedent |
| **M2** (writes) | `Email/set` (flags, move, destroy, drafts via upload), `Identity/get`, `EmailSubmission/set` | no `onSuccess*` submission conveniences beyond the RFC minimum |
| Later / never | `SearchSnippet`, `VacationResponse`, MDN, S/MIME, Sieve, push, multi-account (#407 first needs its own schema work) | — |

## Testing prerequisite (the gate inside the gate)

M1 cannot be contract-verified against `503 imap_connect`. Prerequisite task before M1 starts: **an IMAP fixture in CI** — recommendation: a Dovecot container (dev `compose` profile `mail` next to Mailhog, plus a CI job service) with seeded maildirs, used by a `JmapMailClientContractTest` for the lifecycle (list → sync → flag → move → `UIDVALIDITY` bump → `cannotCalculateChanges`). Unit-level coverage can mock `MailImapClient`, but the lifecycle test needs the real protocol; this is also the first-ever live coverage for the existing mail REST layer — value beyond the envelope.

## Why not defer or reject

- **Defer** would be justified if the sync-cache were throwaway — it is not: #400 (offline mail, adopted) needs exactly this mirror table, and #398 (threads, adopted) needs exactly this derivation. The envelope is the cheapest place to build both once.
- **Reject** would be justified if `ext-imap` could not support honest `/changes` semantics — it can (UIDVALIDITY/UIDNEXT + windowed flag diff), as long as the window limitation is documented and pinned.
- The real risks are operational (fixture maintenance, big-mailbox performance of the first cache fill) and both are contained: cache fill is per-mailbox lazy, and the fixture doubles as REST coverage.

## Consequences for M1's Task (acceptance criteria inputs)

1. Prerequisite: IMAP CI fixture task (filed separately, blocks M1).
2. Migrations `jmap_mail_sync` + `jmap_mail_messages`; schema version bump.
3. Mail state codec (UIDVALIDITY/UIDNEXT/window digest); `cannotCalculateChanges` on UIDVALIDITY change pinned.
4. `MailboxCapabilityProvider`-style `MailCapabilityProvider` gated on mail configured + `ext-imap` present (session omits `urn:ietf:params:jmap:mail` when 503 would result).
5. Envelope methods per the phasing table; batch-scoped IMAP session + per-batch subprocess isolation.
6. `mb-` blob resolver on `/jmap/download`.
7. Lifecycle contract test against the fixture; mixed-domain batch test; done gate.
