Source: #1589 (body-hash: d37a34d6)
Goal: WeGotWorkspace/Product#30

# Verify iMIP replies with DKIM when the mailbox server does not stamp them

Technical follow-up to Epic #1589 ([1589-imip-replies](../1589-imip-replies/spec.md)). Paths are relative to `packages/api/`.

## Goal

Calendar applies an iMIP `REPLY` only when its `From:` address is authenticated. Today the only evidence is the `Authentication-Results` (A-R) header of the mailbox's receiving server, learned as the trusted server id when the mailbox is saved or tested. Many smaller providers never add that header, so their mailboxes connect, report `untrusted_server_unknown`, and never apply a reply.

This change lets the poller verify the reply's DKIM signature itself (RFC 6376, RFC 8301, RFC 8463) against the signer's public key in DNS, and trust the reply when a valid signature's `d=` domain is aligned with the `From:` domain. A-R stays the evidence whenever a trusted server id is known; DKIM is the evidence when none is.

## Non-goals

- SPF or DMARC evaluation of our own. SPF needs the SMTP client address, which the mailbox does not keep reliably; DMARC policy lookup adds nothing once an aligned DKIM signature has passed.
- ARC (RFC 8617). A forwarded reply whose original signature broke is not applied.
- DNSSEC validation of key records.
- Changing the A-R rule or how the trusted server id is learned. A stamp a sender put in the message must never be trusted.
- A public suffix list. Alignment is defined below without one.
- Visible UI. The API reports which check a mailbox uses; the settings copy follows in the settings UI work.

## Affected packages

- `packages/api`: DKIM verifier, DNS key lookup, poller, sender check, mailbox payload, OpenAPI.
- `packages/apps`: the generated OpenAPI types and the mock mailbox gain the new field (no visible change).

## Technical constraints

### Which evidence is used

- Trusted server id known: the existing A-R rule (`ImipSenderAuthentication`), unchanged. DKIM is not consulted, so a mailbox whose server does stamp keeps exactly today's behavior.
- No trusted server id: DKIM. The poller no longer stops at `untrusted_server_unknown`; it reads new mail and checks each reply's signature.

### DKIM verification

- The top 5 `DKIM-Signature` fields of a message are looked at; of those, only the ones whose `d=` is aligned with the `From:` domain are checked. A signature that cannot make the reply trusted is never looked up in DNS. The first passing signature decides.
- The body hash is checked before the key is looked up, so a changed message causes no DNS query.
- Tags: `v=1`, `a`, `b`, `bh`, `d`, `h`, `s` are required; a duplicate tag or a missing required tag fails the signature. `h=` must name `from`. `i=`, when present, is `d=` or a subdomain of it. `q=`, when present, includes `dns/txt`.
- Algorithms: `rsa-sha256` and `ed25519-sha256`. `rsa-sha1` fails (RFC 8301).
- Canonicalization: `simple` and `relaxed` for header and body (`c=`, default `simple/simple`). Bare LF line ends are normalized to CRLF first.
- Body hash: SHA-256 over the canonical body, compared in constant time. `l=` is accepted only when it equals the canonical body length; a signature that covers part of the body fails, so nothing can be appended to a signed reply.
- Header hash: the fields named in `h=`, each taken bottom-up as RFC 6376 5.4.2 says (a name listed more often than it occurs contributes nothing for the extra entries), then the signature field itself with the `b=` value emptied and without its final CRLF.
- Time: `x=` in the past fails (`dkim_expired`); `x=` not after `t=` fails.
- Key record (`<s>._domainkey.<d>` TXT, strings joined): exactly one record that parses as a DKIM key; `v=DKIM1` when present; `k=rsa` (default) or `ed25519` matching `a=`; `h=` when present includes `sha256`; `s=` when present includes `*` or `email`; empty `p=` is a revoked key; `t=y` (testing) is treated as unsigned; `t=s` requires the `i=` domain to equal `d=`.
- RSA keys: 1024 to 4096 bits, `SubjectPublicKeyInfo` or `RSAPublicKey` DER. Ed25519 keys: 32 bytes; the signature is Ed25519 over the SHA-256 hash of the header data (RFC 8463 3).

### Alignment

The signature's `d=` must equal the `From:` domain, or be a parent of it with at least two labels (`d=example.com` covers `From: a@mail.example.com`). The reverse direction (`d=mail.example.com` for `From: a@example.com`), allowed by DMARC relaxed alignment, is not accepted: without a public suffix list it would let a party that controls `x.example-host.com` vouch for `From: a@example-host.com`. Every common calendar sender signs with `d=` equal to the `From:` domain.

### DNS lookup

- One TXT query per selector and domain, through PHP's `dns_get_record` behind a `DnsTxtResolver` interface. It uses the system resolver, so it works under `open_basedir` and needs no new dependency. It has no per-call timeout: a slow resolver is bounded by the system resolver's own timeout (glibc: 5 seconds, 2 attempts per nameserver). While the mailbox clock is still running, the poll stops at the first failed lookup and waits on that one. Once the clock has run out, the poll skips each message whose lookup fails and continues, so it can wait on one lookup per such message in the batch. A failed lookup (`dns_get_record` returning false: a temporary or non-recoverable resolver error) is a temporary error; an empty answer is "no record".
- Selector and domain are checked against DNS name syntax before any query; a name with other characters fails the signature.
- Answers are cached in the shared cache: a key record for 1 hour, "no record" (NXDOMAIN or no TXT) for 10 minutes. A failed lookup (timeout, SERVFAIL, refused, no resolver) is never cached.
- Tests inject a fake resolver; no test makes a real DNS query.

### DNS unreachable: skip and retry, never trust

- A lookup that fails is a temporary error. When no other aligned signature has passed, the reply is neither applied nor skipped: the poll stops at that message, keeps the cursor before it, and records `dns_unavailable` as the mailbox's last error. The next poll (2 minutes later) tries again. Later messages wait, so replies are still applied in arrival order.
- While key lookups keep failing, the mailbox waits at most 1 hour in total, counted from the first failure; after that every message whose lookup fails is skipped with `dkim_dns_unavailable` and the cursor moves past it, until a poll reaches the end of the folder. A sender domain with broken DNS, or many of them, cannot hold up the mailbox for longer than that.

### What the poller fetches

- The header fields fetched per message gain `DKIM-SIGNATURE`, so a message without an aligned signature is refused without downloading it.
- For a reply candidate (calendar part present, method `REPLY` or none, `RFC822.SIZE` within `MAX_MESSAGE_BYTES`), the whole message is fetched once with `BODY.PEEK[]`; nothing is marked read. The calendar part is then fetched as today.

### Replay and old messages

- A DKIM signature stays valid for as long as the key is published, so a copy of an old reply could be sent again. A passing signature is only accepted when its signing time is within the last 72 hours (15 minutes of clock skew allowed): `t=` when present, otherwise the `Date:` field when `h=` signs it. A signature with neither is refused (`dkim_stale`).
- Each accepted signature is remembered per mailbox for 73 hours by the hash of its `b=` value; the same signature again is refused (`dkim_replayed`). A second delivery of the same reply is therefore skipped, like the unchanged-reply rule already does.
- Mail that waited in a mailbox stuck at `untrusted_server_unknown` before this change is read once the change ships, but replies signed more than 72 hours ago are refused.

### Mailbox status

- The poller no longer sets `untrusted_server_unknown`; it stays in the OpenAPI enum for rows written before.
- New error code `dns_unavailable` (poll stopped on a failed key lookup).
- New response field `senderCheck`: `receiving_server` when a trusted server id is known, `dkim` otherwise.

### Logging

- Skipped replies keep the existing `calendar.imip_reply_skipped` line with `reason: sender_not_verified` and add `check` (`receiving_server` or `dkim`) and `detail` (the DKIM reason code, for example `dkim_none`, `dkim_body_hash`, `dkim_stale`). Identifiers only: owner, IMAP UID, reason codes, and the signing domain; never header values, keys or message content.
- A deferred message logs `calendar.imip_reply_deferred` with owner and IMAP UID.

## Edge cases

- Two signatures, one aligned and failing, one unaligned and passing (for example Google Workspace without custom DKIM, signed only by `gappssmtp.com`): refused.
- Two aligned signatures, the first with a broken key record and the second valid: applied.
- An aligned signature whose lookup times out plus another aligned signature that passes: applied, no deferral.
- A second `From:` header added below a signed one: refused (exactly one `From:`).
- A body appended after an `l=` covered part, or any change to a signed header or to the body: refused.
- A revoked key (`p=`), a key in testing mode, a 512-bit RSA key, an `rsa-sha1` signature: refused.
- An `x=` in the past: refused.
- A mailbox that learns its trusted server id later (re-test): it switches to the A-R rule from then on.
