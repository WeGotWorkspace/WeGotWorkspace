Source: #1112 (body-hash: 82d59d6d)

# Collab ticket on the reuse envelope

Technical translation of GitHub issue #1112. The C2 ticket is already issued and verifiable. This slice carries it on the reuse envelope, weighs it in the reuse gate, and documents the configuration JWK.

## Goal

A collaboration reuse envelope may carry an optional `ticket`. When that field is present, the reuse gate verifies it and takes `access` from the payload. When it is absent, the roster check stays in place so a mixed-version room keeps syncing. The room configuration response documents `collabTicket` without making it required, and `RtcPeerDescriptor` names `access` so the roster reader no longer casts.

## Non-goals

- Changing the C2 ticket format, lifetime, refresh, or revocation.
- Changing the update filter or the authorship check.
- Making `ticket` required on `open` or `ack`.

## Affected packages

- packages/apps
- packages/api
- packages/openapi-types

## Technical constraints

- `ticket` stays optional on `CollabReuseEnvelope`. An empty string is not stored.
- `required` on `RtcRoomConfiguration` stays `["rtc"]`.
- `collabTicket.jwk` matches `CollabTicketKeyring::publicJwk()`: EC P-256, `x` and `y` base64url, no private material.
- Verification stays fail-closed: a present ticket that does not verify is dropped, and the roster is not a second chance for that envelope.
- Counted source files stay under 800 lines. Do not rebaseline.

## Edge cases

- A ticket whose `user` or `peer` does not match the envelope is rejected even when the roster would have allowed the sender.
- An envelope with no `ticket` still passes the roster check.
- A client that has no published JWK omits `ticket` on outbound `open` and `ack`, so peers fall back to the roster.
- `close` and `data` may omit `ticket`. A `data` envelope that does include one is verified the same way.
