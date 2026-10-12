# `@/lib/rtc` — WebRTC platform kernel

Shared browser RTC stack for **meet**, **docs**, and future **chat / sheet / slides** apps.

## Layers

| Module                          | Role                                                |
| ------------------------------- | --------------------------------------------------- |
| `config.ts`                     | ICE / TURN → `RTCConfiguration`                     |
| `signaling/http-client.ts`      | HTTP join / poll / send / leave                     |
| `session/peer-mesh.ts`          | **`RtcPeerMesh`** — one ICE engine per room         |
| `session/mesh-signal-inbox.ts`  | Delivery cursor (`since` ack) + RTC signal dispatch |
| `session/bindings.ts`           | Media or data-channel attachment                    |
| `telemetry/selected-pair.ts`    | Logs selected candidate pair on connect             |
| `hooks/use-rtc-session.ts`      | React lifecycle wrapper over `createRtcSession()`   |
| `signaling/create-client.ts`    | `createRtcSignalingClient()` — channel defaults     |
| `session/create-rtc-session.ts` | `createRtcSession()` — signaling + mesh factory     |

Meet uses `meet-core/src/meet-rtc-session.ts` + `use-meet-rtc.ts` (media binding, meet SDP sanitization).
Docs uses `text-editor-core/docs-collab/docs-rtc-session.ts` (data binding).

Both use `recoverOnUnknownPeer: true` via `createRtcSession()`. Meet selects `MEET_RTC_POLL_INTERVALS` (400 ms connecting, 1200 ms active steady) and backs off to **4 s** when all media peers are connected and no knockers are waiting; collab data channels idle at **15 s**.

Signaling uses `/api/v1/rooms/{roomId}/*` (`signalingApiSegment()` returns `rooms` in `types.ts`).

## Per-app pattern

- `createRtcSession()` / `*-rtc-session.ts` — shared factory + thin app wrappers
- `use-*-rtc.ts` — bindings and product hooks
- `use-*-controller.tsx` — product UX only; **no** `RTCPeerConnection`

## Debug

Turn on detailed connection logs in **Admin → Real-time collaboration → Diagnostics**. After a reload, browsers write `[rtc]` lines. Without the switch (or a test override) the logger is silent.

Logs use prefix `[rtc][channel][peerId][event]` plus `tMs` (`performance.now()`) and ISO `at` on every line. Events cover join, roster, linger park/resume/drop, poll 200/204 and interval, offer/answer sent/received (SDP type + byte length only), ICE gathering/connection state, data-channel open, first remote sync/awareness, and why a peer was skipped. No tokens, no full SDP.

Force TURN relay-only mode:

- Admin → Real-time collaboration → Diagnostics → Always use the TURN relay (only while TURN is configured)
- Vite/Storybook local: `VITE_WGW_RTC_FORCE_RELAY=1` in `.env.local`
- Playwright: `setRtcTestOverrides(context, { debug: true, forceRelay: true })`

Manual network checks: [`docs/testing/rtc-network-matrix.md`](../../../../docs/testing/rtc-network-matrix.md)

## Initiator rules

| Channel           | Rule                       |
| ----------------- | -------------------------- |
| `meet` (Meet A/V) | Higher peer id sends offer |
| `collab` (docs)   | Lower peer id sends offer  |

Set via `initiatorRule: "higherId" | "lowerId"` on `RtcPeerMesh`.

## Principal mesh (presence) — cross-window leadership

Suite presence (`presence-core`) dials the workspace principal room from **one sticky leader window** (`BroadcastChannel` `wgw.principal.tab`, Phase 4 / #695). Followers proxy presence/chat/typing envelopes through the leader and do not join signaling.

**Handoff blip:** when the leader window closes, a follower becomes leader and re-dials. `RTCPeerConnection` cannot transfer across windows, so expect a short **~0.5–2 s** gap on the shared presence/collab-reuse layer until the new leader’s mesh is up. Leadership does **not** bounce on `visibilitychange` hide (unlike docs-collab tab sync).

## Relay fallback

On `connectionState === "failed"`, initiator **recreates** the peer connection in relay-only mode and sends a fresh offer (not `setConfiguration` + `restartIce`).

## Meet invariants

These rules are enforced in product code and covered by unit tests under `session/peer-mesh.test.ts` and `meet-core/src/meet-rtc-session.test.ts`:

| Topic          | Rule                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| A/V transport  | WebRTC media binding only (`createMediaBinding`)                                                                 |
| Chat + control | Chat over the Meet data channel with HTTP as fallback and dedupe; admit and server-recorded control stay on HTTP |
| Signaling      | HTTP join / poll / send / leave on `/rooms/{roomId}/*`                                                           |
| Meet SDP       | **Sanitize inbound (remote) only** — never rewrite outbound/local SDP before `setLocalDescription`               |
| Guest tabs     | Unauthenticated `fetchImpl` + `sessionKey` on poll/send/chat                                                     |
| Initiator      | Meet uses `higherId` (lexicographically higher peer id sends the offer)                                          |
| Poll order     | `onPollData` runs before RTC signal handling (chat/control before offer/answer)                                  |
| Poll cursor    | `MeshSignalInbox` acks **every** delivered row — chat, control, and while RTC signals are off                    |
| Poll timeout   | `AbortSignal.timeout(10_000)`; an aborted poll reschedules like any other poll failure                           |

Run kernel tests:

```bash
pnpm --dir packages/apps exec vitest run src/lib/rtc/session src/meet-core/src/meet-rtc-session.test.ts
```
