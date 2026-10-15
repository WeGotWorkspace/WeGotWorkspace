# Raw Yjs bytes on the data channel

Derived from [spec.md](./spec.md).

## Goal

Put the Yjs tail on the data channel as raw bytes behind a JSON header, and keep HTTP, signaling, and the frame bounds unchanged.

## Budget

Draws from the real-time hardening milestone. No other chunk is displaced.

## Non-goals

- HTTP base64, signaling caps, sidecar storage, and the #1261 bounds.
- A second binary payload, a kept JSON-string send path, or new dependencies.

## What exists

- Frames are already 16 KiB with an 8-byte header, and the pending-message caps are in place. `path: packages/apps/src/lib/rtc/session/data-channel-frames.ts:16`
- The data-channel message codec writes the uint16 header length and the raw tail. `path: packages/apps/src/lib/rtc/session/data-channel-frames.ts:86`
- Collab splits `u` into that header and tail. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-channel.ts:8`
- HTTP still base64-encodes Yjs and splits at 63 KiB. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-http-wire.ts:57`
- Signaling still advertises `bin`, `yjs-http`, and `relay-jit`. `path: packages/apps/src/lib/rtc/signaling/create-client.ts:41`
- Sidecar snapshots still store `yjs` as a number array. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-server-io.ts:76`

## Considered

Considered: leaving `peerAdvertisesBin` as a send-time branch — rejected because every peer is framed and a string on the channel is not a message. Considered: putting `bin` on the reuse envelope — rejected because the tail belongs to the nested payload.

## Affected packages

- packages/apps

## Dependencies

The codec lands before the collab and Meet callers. One pull request, no parallel chunk.

## Open decisions

None — every choice for this work is made.

## Invariants

- A header length past the buffer does not decode. A wrong change accepts a truncated header as a message. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` assertion `rejects a header length that falls outside the buffer`.
- The #1261 bounds stay 30000, 4, 4096, and 16 MiB. A wrong change drops in-flight messages earlier. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` assertion `keeps the frame bounds from #1261`.
- A channel string produces no message. A wrong change revives the JSON-string path. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` assertion `treats a channel string as no message`.
- A missing payload stays null and an empty tail stays a zero-length `Uint8Array`. A wrong change collapses poke and an empty sync. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` assertion `keeps a missing payload distinct from an empty one`.
- A viewer still cannot put a document update on the wire. A wrong change lets a reader broadcast a step 2. Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-rtc-session.test.ts` assertion `keeps a viewer from putting a document update on the wire`.
- HTTP fragments of a 1200-row sheet stay within the encoded cap. A wrong change would push the mailbox over 63 KiB. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts` assertion `syncs a 1200-row sheet over $name`.

## Chunks

### Chunk A: raw data-channel payloads

- **id:** `data-channel-raw-bytes`
- **Skill:** workspace
- **Inputs:** frame codec — `path: packages/apps/src/lib/rtc/session/data-channel-frames.ts:86`
- **Done when:** sync and awareness travel as `Uint8Array`, the conformance table passes for the data channel and HTTP, and the existing collab and frame suites stay green.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab/collab-transport-conformance.test.ts src/lib/rtc/session/data-channel-frames.test.ts`
- **Parallel with:** none

## Test plan

- [ ] Vitest conformance for part A bytes and part B Yjs updates on both transports
- [ ] Existing `docs-collab` suites, frame reassembly, bindings, and the RTC session tests
- [ ] Apps typecheck, lint, and the apps done gate

## Doc updates (only if user wants)

- None.
