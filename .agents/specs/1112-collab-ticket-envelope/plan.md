# Collab ticket on the reuse envelope

## Goal

Carry the optional C2 ticket on the reuse envelope, verify it in the reuse gate, and publish `collabTicket` on the room configuration contract. See [spec.md](./spec.md).

## Budget

Draws from the real-time hardening milestone on issue #1112. Displaces no other chunk: this worktree does not touch the rtc-chaos-suite branch.

## Non-goals

- Changing the C2 ticket format, lifetime, refresh, or revocation.
- Changing the update filter or the authorship check.
- Making `ticket` required on `open` or `ack`.

## What exists

- Application-level `CollabReuseEnvelope` / `DocsCollabPrincipalReuse` were removed; ticket checks for Docs now run on link-channel hellos (`lib/rtc/link/collab-hello-verify.ts`) with the collab roster published via `LinkChannelClient.setRoom`.
- `verifyCollabTicket` and `createCollabTicketKeyCache` already check the signature, `kid`, claims, and skew. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-ticket.ts:124`
- `configuration()` returns `collabTicket` from `publicJwk()`, and `RtcRoomConfiguration` documents only `rtc`. `path: packages/api/app/Services/Collab/DocCollabSignalingService.php:61` `path: packages/api/openapi/schemas/rtc/rtc-signaling.json:117` `path: packages/api/app/Services/Collab/CollabTicketKeyring.php:44`
- `RtcPeerDescriptor` has no `access`, so the roster reader casts. `path: packages/apps/src/lib/rtc/types.ts:53` `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-access.ts:56`
- The configuration fetch reads `rtc` from an untyped payload and drops every other field. `path: packages/apps/src/lib/api/wgw/rtc.ts:12`

## Considered

Considered: keeping `mayReuseWith` synchronous by pre-warming `createCollabTicketKeyCache` only. Rejected because `verifyCollabTicket` awaits `crypto.subtle.verify` even after the key is imported. Chosen: the envelope handler awaits verification when `ticket` is present, and the key cache is still pre-warmed from the configuration JWK before join.

## Affected packages

- packages/apps
- packages/api
- packages/openapi-types

## Dependencies

1. OpenAPI `collabTicket` slot and regenerated `openapi-types.ts`.
2. Ticket publication on the collab room configuration client, then link-channel hello verification.

## Open decisions

Ticket verification awaits `verifyCollabTicket` (WebCrypto). `createCollabTicketKeyCache` is still pre-warmed from the configuration JWK before the session joins. Access is the tighter of ticket claims and the published collab roster (D5).

## Invariants

- A missing ticket still has to pass the roster check on the receiving browser. Proof: `path: packages/apps/src/lib/rtc/link/collab-hello-verify.test.ts`
- A present ticket that names a different `user` or `peer` is rejected, and the roster is not a fallback for that hello. Proof: `path: packages/apps/src/lib/rtc/link/collab-hello-verify.test.ts`
- `RtcRoomConfiguration.required` stays `rtc` only, and the published JWK stays the public half. Proof: `path: packages/api/tests/Feature/Collab/CollabTicketTest.php`

## Chunks

### Chunk A: collab-ticket-envelope

- **id:** `collab-ticket-envelope`
- **Skill:** workspace
- **Inputs:** ticket + JWK published on `setRoom`; hello verify in `lib/rtc/link/collab-hello-verify.ts`
- **Done when:** optional `ticket` is verified on the receiving browser; a missing ticket uses the roster; `collabTicket` is on the configuration schema and the generated type; `RtcPeerDescriptor.access` replaces the cast; issue #1112 acceptance criteria pass via [verify-issue](../../skills/verify-issue/SKILL.md).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/rtc/link/collab-hello-verify.test.ts src/text-editor-core/docs-collab/docs-collab-ticket.test.ts` and `pnpm --filter @wgw/apps typecheck`
- **Parallel with:** none

## Test plan

- [ ] Envelope unit test: non-empty `ticket` round-trips; empty and non-string values are dropped.
- [ ] Reuse tests: valid ticket supplies `access`; mismatched `user` or `peer` is rejected; no `ticket` still follows the roster.
- [ ] Existing configuration feature test still sees the public JWK.

## Doc updates (only if user wants)

- None.
