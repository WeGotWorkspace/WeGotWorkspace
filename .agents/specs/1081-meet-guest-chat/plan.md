# Live chat for guests in a Meet call

Derived from [spec.md](./spec.md).

## Goal

Guests in a Meet call receive chat on the negotiated Meet data channel, with the room HTTP post as the fallback and the dedupe key.

## Budget

No separate budget. The work stays inside the existing RTC mesh and Meet call session.

## Non-goals

- Channel history, reactions, threads, edit, delete, and room-line persistence
- Opening data-channel id 2
- Changing OpenAPI

## What exists

- Meet peer connections are media-only today. `path: packages/apps/src/meet-core/src/meet-rtc-session.ts:119`
- Room chat is posted immediately with the channel client id. `path: packages/apps/src/meet-core/src/use-meet-mutations.ts:327`
- `meet-dc` is already a known join cap on the server and the client union. `path: packages/apps/src/lib/rtc/types.ts:17`
- `peer-mesh.ts` is under the 800-line ceiling. New behavior lives beside it. `path: packages/apps/src/lib/rtc/session/peer-mesh.ts:1`

## Considered

Considered: switching Meet onto `createDataBinding` — rejected because that binding replaces media and uses an in-band label instead of a negotiated id. Chosen: open channel id 1 next to the media binding when the peer connection is created.

## Affected packages

- packages/apps

## Dependencies

- Client ULID from #1084, already on this integration tip
- Cursor acknowledgements from #1086, already on this integration tip

## Invariants

- The negotiated Meet channel stays on id 1. A wrong change opens id 2. Proof: `path: packages/apps/src/lib/rtc/session/meet-data-channel.test.ts` assertion `creates the negotiated meet channel and does not open id 2`
- A guest line arrives once: under 300 ms on an open channel, and once over HTTP when that channel is blocked. A wrong change duplicates or drops the line. Proof: `path: packages/apps/src/lib/rtc/session/meet-room-chat.test.ts` assertion `delivers guest chat over an open channel in under 300ms and once when the channel is blocked`
- The same ULID from a different peer stays a different line. A wrong change collapses those copies. Proof: `path: packages/apps/src/meet-core/src/meet-data-chat.test.ts` assertion `dedupes the later HTTP copy on sender and ULID, not on the id alone`
- Admit and mute that arrive on the data channel are not applied. A wrong change runs them from the frame. Proof: `path: packages/apps/src/meet-core/src/meet-data-chat.test.ts` assertion `does not run admit or mute that arrives on the data channel`

## Chunks

| id | scope | verify |
|----|--------|--------|
| `meet-guest-chat` | Negotiated channel, cap, send path, dedupe, docs | `pnpm --dir packages/apps exec vitest run src/lib/rtc/session/meet-data-channel.test.ts src/lib/rtc/session/meet-room-chat.test.ts src/meet-core/src/meet-data-chat.test.ts src/meet-core/src/meet-rtc-sdp.test.ts` |

Live (nightly, not a PR check): `pnpm --dir packages/apps exec playwright test --config playwright.live.config.mjs e2e/meet-guest-chat.spec.ts` with the apps dev server and API already up.

## Open decisions

None.
