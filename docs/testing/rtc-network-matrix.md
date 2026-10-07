# RTC network matrix (manual audit)

Enable browser logging with `?rtcDebug=1` on meet or docs URLs. Logs use prefix `[rtc][channel][peerId][event]`.

## Prerequisites

- Admin **Meet** settings: valid STUN URL(s) and external TURN (`turn:host:3478?transport=udp` format).
- TURN uses a shared secret (`coturn` `use-auth-secret`). There are no static credentials.
- Trickle ICE test page shows a **relay** candidate row before go-live.
- Docker dev stack or shared-hosting install with `/api/v1/rooms/*` reachable.

## Scenarios

| ID | Scenario | Steps | Pass criteria |
| -- | -------- | ----- | ------------- |
| N0 | Direct LAN | Two browsers, same network, meet room | `[rtc][meet][…][selected-pair]` shows `host` or `srflx`; A/V connected |
| N1 | Guest meet TURN | Guest join URL (no auth) | Configuration returns `turnAvailable` only. Credentials come from `POST /rooms/{id}/relay`. A knocking peer receives 403 |
| N2 | Docs collab | Two users, same doc | Data channel open; Yjs sync; `[rtc][collab][…][dc-open]` |
| N3 | Force relay (debug) | Add `?rtcForceRelay=1` or set `VITE_WGW_RTC_FORCE_RELAY=1` | `iceTransportPolicy: relay` in `pc-created` log; selected pair `relay` |
| N4 | Relay fallback | Symmetric NAT or firewall block direct | `[relay-fallback-start]` then `[relay-fallback-offer-sent]` or connected |
| N5 | Hotspot | Phone hotspot client | Session connects (often via `relay`); no endless `failed` |
| N6 | Unknown peer recovery | Docs: stale tab after server prune | `[peer-recover-start]` / `[peer-recover-success]` |
| N7 | Poll steady | In-call 5+ minutes | Poll continues; no HTML error responses |
| N8 | Leave cleanup | Leave meet/docs | Peers removed; `/leave` succeeds |
| N9 | Collab signaling API | `pnpm test:collab-api` | join/poll/send/leave return JSON |
| N10 | Meet signaling API | `pnpm test:meet-api` | Guest join/poll/leave on `/api/v1/rooms/*` return JSON |
| N11 | Meet mesh smoke | Two tabs, same room, `?rtcDebug=1` | `[rtc][meet][…][pc-connection-state]` has `connectionState` `connected`; inbound RTP bytes increase; remote tile shows A/V; outbound offer SDP includes `m=audio` and `m=video`; no `Illegal invocation` in console |
| N12 | Guest meet control | Guest knock URL (no auth) → host admits | Guest reaches `in-call`; knock/admit chat control works; guest `sessionKey` on poll/chat; media presence toggles propagate |
| N13 | iOS Safari remote audio | **Human-only.** Join a Meet call in iOS Safari | Remote audio stays silent until a user gesture, then plays |
| N14 | Installed PWA camera | **Human-only.** Open the installed PWA in standalone mode and join a Meet call | Camera permission succeeds in standalone mode and local video shows |
| N15 | Resume from background | **Human-only.** On iOS Safari and on the installed PWA, background a Meet call or Docs session, then return | The client polls immediately and restarts ICE; the call or document stays connected |

N13–N15 are human-only. A person runs them before the v0.9 release. Do not assign that run to an agent.

## Automated relay tier

`pnpm test:rtc-relay` runs the Playwright tier against a local coturn. It is nightly CI only, not a pull-request check.

| Test | Matrix |
| ---- | ------ |
| direct path stays direct | N0, N11 |
| forced relay — Meet | N3 |
| forced relay — Docs | N2, N3 |
| credential refresh keeps the call | refresh |
| lobby gets no relay | N1, N12 |
| no TURN configured is reported | admin health |
| leave cleans up | N8 |

Not automated: N4 and N5 (real NAT or hotspot), N13–N15 (iOS Safari and the installed PWA), and `turns:` TLS.

## Shared hosting notes

- Signaling is **HTTP poll only** (Apache + mod_php); no WebSocket daemon required.
- TURN must be **external** (coturn on VPS); STUN-only is insufficient for ~20% of networks.

## SDP sanitizer (2026-10-04)

The pair that required stripping is Safari (WebKit) against Chromium. Unit tests in `meet-rtc-sdp.test.ts` cover it:

- Chromium parsing a Safari description strips `a=extmap-allow-mixed`, `a=rtcp-rsize`, and plan-b `a=ssrc`, and keeps RTX and Opus RED.
- Safari parsing a Chromium description strips RTX and Opus RED, and keeps those session lines.
- H.265/HEVC, AV1, and VP9 are stripped for every parser. Inbound Opus fmtp gains `usedtx=1`.

N4, N5, and N13–N15 were not re-executed. N4 and N5 need a second network (symmetric NAT or a phone hotspot). N13–N15 need a person on iOS Safari and the installed PWA. This note is not a pass of those scenarios.
