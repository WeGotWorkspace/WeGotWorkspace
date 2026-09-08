# RTC Phase 4 — cross-window principal-mesh leader

Derived from [spec.md](./spec.md).

## Goal

Sticky BroadcastChannel principal-mesh leader across windows/tabs so only one window dials the principal room; followers proxy envelopes; handoff on leader close is tested and documented.

## Non-goals

- SFU, Meet call leadership, transferring PeerConnections, cross-window collab reuse of the leader DC

## Affected packages

- packages/apps (`presence-core`, brief `lib/rtc` README note)
- `.agents/specs/695-rtc-cross-window-leader/` + pointer in `000-rtc-connection-optimization`

## Dependencies

1. Chunk A (pure coordinator) before Chunk B (store wiring)
2. Chunk C (docs / go-no-go note) can parallel Chunk B after A’s API is stable

## Chunks

### Chunk A: sticky principal tab coordinator

- **id:** `principal-tab-sync`
- **Skill:** meet, testing
- **Inputs:** `docs-collab-tab-sync.ts` pattern; #695 design (sticky + proxy messages)
- **Done when:** `principal-tab-sync.ts` elects sticky leader on `wgw.principal.tab`; no resign on hide; resign on pagehide/leave; unit tests for election, sticky-on-hide, resign/handoff signals, and message typing for envelope proxy
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/presence-core/src/principal-tab-sync.test.ts`
- **Parallel with:** none

### Chunk B: PresenceStore leader / follower wiring

- **id:** `presence-leader-wire`
- **Skill:** meet, workspace
- **Inputs:** Chunk A coordinator; `PresenceStore`, `PresenceProvider`, `PresenceMeshSession`
- **Done when:** only the leader creates/joins a real principal session; followers expose the same store surface via BC-proxied envelopes + roster snapshots; leader close → follower becomes leader and joins (handoff); integration tests cover proxy path + handoff
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/presence-core`
- **Parallel with:** `handoff-docs` (after A API frozen)

### Chunk C: handoff docs + go/no-go note

- **id:** `handoff-docs`
- **Skill:** document
- **Inputs:** spec edge cases; `packages/apps/src/lib/rtc/README.md` or presence-core comment
- **Done when:** ~0.5–2 s handoff blip documented; `000-rtc` points at #695; go/no-go status recorded in spec.md
- **Verify with:** docs review / `verify-issue` against #695
- **Parallel with:** `presence-leader-wire`

## Test plan

- [ ] Unit: sticky election, no resign on hide, resign on pagehide, stale leader takeover
- [ ] Unit/integration: follower proxy broadcast/send path; leader relays inbound envelopes + roster
- [ ] Integration: leader close → follower join + dial (mocked session)
- [ ] Manual (pre-ship): two desktop windows same user — one principal peer in signaling roster; hide leader tab without close — leadership sticky

## Doc updates

- Spec go/no-go note; brief RTC/presence handoff blip; `000-rtc` Phase 4 pointer to #695
