# Docs live sync over HTTP

Derived from [spec.md](./spec.md).

## Goal

Carry Docs Yjs updates on the collab mailbox when a data channel does not open, and surface the admin banner for `relay_unavailable`.

## Budget

Draws from the real-time hardening milestone. No other chunk is displaced.

## Non-goals

- Server-side Yjs merging.
- WebSockets.
- OpenAPI changes.
- Meet copy and the daily admin notification.

## What exists

- Collab mailbox send and the `yjs` / `yjs-sv` schema are already on the contract. `path: packages/api/openapi/schemas/rtc/rtc-signaling.json:231`
- `requestRelay` is channel-agnostic. `path: packages/apps/src/lib/rtc/session/relay-request.ts:43`
- The network probe is session-wide. `path: packages/apps/src/lib/rtc/net-probe.ts:185`
- The chaos scenario for forced HTTP fallback is already written. `path: packages/apps/e2e/rtc-chaos.spec.ts:197`
- The update guard drops reader mutations. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-update-guard.ts:63`

## Considered

Considered: enabling Meet's `MeshRelay` timer for collab — rejected because Docs must keep editing on HTTP while the relay request is in flight, and the 5 second / 8 second deadlines are not Meet's.

## Affected packages

- packages/api
- packages/apps

## Dependencies

Server mailbox rules before the client send path. The banner and the chaos scenario follow the client.

## Open decisions

None — every choice for this work is made.

## Invariants

- A read-only collab peer still cannot put a document update on the wire. A wrong change lets a viewer rewrite the body. Proof: `path: packages/api/tests/Feature/Collab/CollabYjsMailboxTest.php` assertion `test_a_reader_cannot_publish_an_update`.
- Offer and answer signaling still delivers. A wrong change breaks the data-channel handshake. Proof: `path: packages/api/tests/Feature/Collab/CollabEndpointsTest.php` assertion `test_two_users_exchange_signaling_messages`.

## Chunks

### Chunk A: docs-http-fallback

- **id:** `docs-http-fallback`
- **Skill:** workspace
- **Inputs:** mailbox send — `path: packages/api/app/Services/Collab/DocCollabSignalingService.php:183`
- **Done when:** C4 is enforced on the server, the client falls back per peer, the fuzz test passes, and the chaos scenario is no longer `fixme`.
- **Verify with:** `pnpm --filter @wgw/apps exec vitest run src/text-editor-core/docs-collab/docs-collab-http-fuzz.test.ts` and `php packages/api/vendor/bin/phpunit tests/Feature/Collab/CollabYjsMailboxTest.php`
- **Parallel with:** none

## Test plan

- [ ] API: feature tests for fan-out, reader 403, 64 KiB, and the per-second cap
- [ ] UI: Vitest for the wire split, the fallback timers, the banner copy, and the 500-iteration fuzz
- [ ] Chaos: `forced HTTP fallback syncs two editors` is a live test

## Doc updates (only if user wants)

- None.
