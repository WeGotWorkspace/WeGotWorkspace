# Verify iMIP replies with DKIM

Derived from [spec.md](./spec.md). Line references are to `origin/main` at `348a0ff62` (2026-11-16). Paths are relative to `packages/api/`.

## Goal

Mailboxes whose receiving server adds no `Authentication-Results` header can apply calendar replies: the poller verifies the reply's DKIM signature against DNS and trusts an aligned, fresh, unseen signature. Mailboxes with a trusted receiving server keep the A-R rule unchanged.

## Budget

- **Draws from:** Epic #1589 (Pioneer programme), the work that makes inbound replies work for the mailboxes the Epic's first version left waiting.
- **Displaces:** nothing in the A-R path; the "not reading yet" state the settings UI shows for those mailboxes becomes rare.

## Non-goals

See spec.md, Non-goals.

## What exists

- The poller returns `untrusted_server_unknown` and reads nothing while no trusted server id is known. `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPoller.php:140`
- The trusted server id is learned only on save or test, from the topmost A-R header of the newest messages. `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPoller.php:203`
- The A-R rule: first header with the trusted id, dkim/spf/dmarc pass aligned with `From:`. `path: packages/api/app/Services/Calendars/Imip/ImipSenderAuthentication.php:23`
- Its alignment accepts a subdomain in either direction when the parent has two labels. `path: packages/api/app/Services/Calendars/Imip/ImipSenderAuthentication.php:90`
- The sender check runs inside the ingest, before the calendar part is parsed. `path: packages/api/app/Services/Calendars/Imip/ImipReplyIngest.php:103`
- Per-message fetch: `RFC822.SIZE`, `BODYSTRUCTURE` and four header fields; the body section is fetched separately with `BODY.PEEK`. `path: packages/api/app/Services/Calendars/Imip/ImapClient.php:24`, `path: packages/api/app/Services/Calendars/Imip/ImapClient.php:159`
- Messages over 1 MiB are skipped before any body is read. `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPoller.php:31`
- The mailbox payload exposes the trusted server id and the last error code; the OpenAPI enum lists `untrusted_server_unknown`. `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPayload.php:156`, `path: packages/api/openapi/schemas/calendars/reply-mailbox.json:23`
- No DKIM or DNS library is installed; the runtime requirements are Laravel, Sabre, Passport, JWT, web-push, icalcreator and swagger-ui. `path: packages/api/composer.json:6`
- Composer licenses are checked against an allow list that includes MIT. `path: tools/license-policy.json:27`

## Considered

- **Relax the trusted-server learning rule** (accept a mailbox where only some messages carry A-R): rejected. On a real mailbox at a Cyrus + SpamAssassin provider, 19 of 20 messages had no A-R header and the one that did carried the sender's outgoing filter's stamp; trusting it would trust a header the sender wrote.
- **`phpmailer/dkimvalidator`** (MIT, v0.3.1, 2025-10): rejected. RSA only (no Ed25519), pre-1.0, and it calls `dns_get_record` statically, so there is no timeout, no cache and no way to inject a fake resolver in tests.
- **`dachs/mail-auth`** (MIT, v0.1.1, 2026-06): rejected. Five months old with one release line and few installs, and it pulls an SPF library and a public suffix parser this check does not use.
- **Own DKIM verifier**: chosen. About 400 lines on `ext-openssl` and `ext-sodium` (both already loaded), covered by RFC 8463's published test vector and by fixtures signed with dkimpy, an independent implementation.
- **`dns_get_record`** behind a `DnsTxtResolver` interface: chosen. No dependency, works under `open_basedir` (it uses the system resolver, not `/etc/resolv.conf` directly), and tells a temporary failure (false) from no record (empty). Its weakness is the missing per-call timeout, bounded by stopping the poll at the first failed lookup.
- **`pear/net_dns2`** (MIT, v2.0.7, 2025-11, zero dependencies): not added in this change. It would give a per-query timeout, but it is about 18,000 lines for one TXT query, needs a readable `/etc/resolv.conf` (so `dns_get_record` would stay as a fallback), and adding a dependency was not approved for this session. The resolver interface lets it replace the `dns_get_record` resolver later without touching the verifier.
- **A hand-written UDP DNS client**: rejected. Packet parsing with compression pointers is security-sensitive code a maintained library already covers.
- **DMARC relaxed alignment in both directions**: rejected for the DKIM path. Without a public suffix list, `d=` a subdomain of the `From:` domain would let a tenant of a shared hosting domain vouch for the shared domain. The A-R path keeps its rule; the receiving server computed DMARC there.
- **Try DKIM when the A-R rule refuses**: rejected. The trusted server's verdict saw the SMTP session and stays authoritative; mixing them would make a refused message pass on a second opinion.
- **Continue past a message whose key lookup failed**: rejected. A later reply from the same attendee could be applied first and then be overwritten by the older one once DNS answers.
- **Remember the deferral in a new column**: rejected for a cache key with the first-deferral time. Losing it only restarts the one-hour window.

## Affected packages

- packages/api
- packages/apps (generated OpenAPI types and the mock mailbox only)

## Dependencies

1. Chunk A (DKIM verifier and DNS key lookup) before chunk B.
2. Chunk B (poller, sender check, status, OpenAPI) after A.

## Open decisions

None — every choice is made. Choices taken without Wouter, to confirm in review:

1. Freshness window 72 hours, replay memory 73 hours.
2. DNS give-up after 1 hour per message.
3. One-directional alignment for DKIM (`d=` equal to or a parent of the `From:` domain).
4. New payload field `senderCheck` instead of reusing `trustedServer: null`.
5. `dns_get_record` without a new dependency; `pear/net_dns2` is the option if a per-query timeout is wanted.

## Invariants

- A mailbox with a trusted server id is checked by the A-R rule only. A wrong change would apply a reply the receiving server refused because its DKIM signature still verifies. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxDkimTest.php` assertion `test_trusted_server_refusal_is_not_overridden_by_dkim`.
- A sender-written A-R stamp never makes a reply trusted. A wrong change would teach the trusted id from the mail being applied. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxPollTest.php` assertion `test_a_forged_header_cannot_teach_the_trusted_server_when_mail_is_not_stamped`.
- A reply without a passing aligned DKIM signature changes nothing on a mailbox without a trusted server. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxDkimTest.php` assertion `test_unsigned_reply_is_not_applied`.
- A failed key lookup never trusts and never loses the reply within the retry window. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxDkimTest.php` assertion `test_dns_failure_defers_and_the_next_poll_applies`.
- The mailbox stays read-only: no `BODY[` fetch without `.PEEK`. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxPollTest.php` assertion `test_mailbox_is_opened_read_only`.
- Tests never query real DNS. Proof: `path: packages/api/tests/Feature/Calendars/ImipMailboxDkimTest.php` binds `FakeDnsTxtResolver` in `setUp`; `cmd: grep -rn "SystemDnsTxtResolver" packages/api/tests` finds no test that constructs it.
- After chunk A, main still works without chunk B: nothing calls the verifier. Proof: `cmd: cd packages/api && php vendor/bin/phpunit tests/Feature/Calendars`.

## Chunks

### Chunk A: DKIM verifier and DNS key lookup

- **Skill:** api, security
- **Inputs:** RFC 6376, RFC 8301, RFC 8463; message bytes as IMAP returns them (CRLF). `path: packages/api/app/Services/Calendars/Imip/ImapClient.php:159`
- **Done when:** `Dkim\DkimVerifier` verifies `rsa-sha256` and `ed25519-sha256` with both canonicalizations and enforces every tag and key rule of spec.md; `Dkim\DkimKeyStore` caches answers; `Dkim\SystemDnsTxtResolver` maps `dns_get_record` results; RFC 8463 A.3 verifies; dkimpy fixtures verify; tampered copies fail.
- **Verify with:** `cd packages/api && php vendor/bin/phpunit tests/Unit/Calendars/Imip`
- **Parallel with:** none

### Chunk B: poller, sender check and status

- **Skill:** api, security
- **Inputs:** poller read loop — `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPoller.php:131`; ingest sender check — `path: packages/api/app/Services/Calendars/Imip/ImipReplyIngest.php:103`; payload — `path: packages/api/app/Services/Calendars/Imip/ImipMailboxPayload.php:156`
- **Done when:** `ImipSenderVerifier` picks A-R or DKIM, applies freshness and replay rules; the poller fetches `DKIM-SIGNATURE` and the whole message for reply candidates, defers on DNS failure and gives up after an hour; `senderCheck` and `dns_unavailable` are in OpenAPI and the payload.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Unit: canonicalization (simple/relaxed header and body, empty body, trailing lines), tag parsing, key record parsing, alignment.
- [ ] Unit: RFC 8463 A.3 (both signatures), dkimpy fixtures (rsa 2048 simple/simple, relaxed/relaxed with `l=`, ed25519 relaxed/simple), tampered header, tampered body, appended body after `l=`, `x=` past, `rsa-sha1`, 512-bit key, revoked key, `t=y`, missing `from` in `h=`.
- [ ] Unit: key store caching (found 1 h, none 10 min, error not cached) with a fake resolver.
- [ ] Feature: poll applies a DKIM-signed reply without a trusted server, refuses unsigned, unaligned, stale and replayed ones, defers on DNS failure and applies on the next poll, gives up after an hour, keeps the A-R rule when a trusted server is known, reports `senderCheck` and `dns_unavailable`.

## Doc updates (only if user wants)

- `packages/api/docs/mail/README.md`: inbound replies are verified by the receiving server's stamp or by DKIM.
