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

- Meet peer connections are media-only today. `packages/apps/src/meet-core/src/meet-rtc-session.ts`
- Room chat is posted immediately with the channel client id. `packages/apps/src/meet-core/src/use-meet-mutations.ts`
- `meet-dc` is already a known join cap on the server and the client union.
- `peer-mesh.ts` is under the 800-line ceiling. New behavior lives beside it.

## Considered

Considered: switching Meet onto `createDataBinding` — rejected because that binding replaces media and uses an in-band label instead of a negotiated id. Chosen: open channel id 1 next to the media binding when the peer connection is created.

## Affected packages

- packages/apps

## Dependencies

- Client ULID from #1084, already on this integration tip
- Cursor acknowledgements from #1086, already on this integration tip

## Chunks

| id | scope | verify |
|----|--------|--------|
| `meet-guest-chat` | Negotiated channel, cap, send path, dedupe, docs | `pnpm --dir packages/apps exec vitest run src/lib/rtc/session/meet-data-channel.test.ts src/lib/rtc/session/meet-room-chat.test.ts src/meet-core/src/meet-data-chat.test.ts` |

## Open decisions

None.
