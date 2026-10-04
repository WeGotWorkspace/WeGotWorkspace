# RTC network matrix (manual audit)

Enable browser logging with `?rtcDebug=1` on meet or docs URLs. Logs use prefix `[rtc][channel][peerId][event]`.

## Prerequisites

- Admin **Meet** settings: valid STUN URL(s) and external TURN (`turn:host:3478?transport=udp` format).
- Trickle ICE test page shows a **relay** candidate row before go-live.
- Docker dev stack or shared-hosting install with `/api/v1/meet/*` and `/api/v1/collab/*` reachable.

## Scenarios

| ID | Scenario | Steps | Pass criteria |
| -- | -------- | ----- | ------------- |
| N0 | Direct LAN | Two browsers, same network, meet room | `[rtc][meet][…][selected-pair]` shows `host` or `srflx`; A/V connected |
| N1 | Guest meet TURN | Guest join URL (no auth) | Guest bootstrap RTC has turn URLs; not empty defaults |
| N2 | Docs collab | Two users, same doc | Data channel open; Yjs sync; `[rtc][collab][…][dc-open]` |
| N3 | Force relay (debug) | Add `?rtcForceRelay=1` or set `VITE_WGW_RTC_FORCE_RELAY=1` | `iceTransportPolicy: relay` in `pc-created` log; selected pair `relay` |
| N4 | Relay fallback | Symmetric NAT or firewall block direct | `[relay-fallback-start]` then `[relay-fallback-offer-sent]` or connected |
| N5 | Hotspot | Phone hotspot client | Session connects (often via `relay`); no endless `failed` |
| N6 | Unknown peer recovery | Docs: stale tab after server prune | `[peer-recover-start]` / `[peer-recover-success]` |
| N7 | Poll steady | In-call 5+ minutes | Poll continues; no HTML error responses |
| N8 | Leave cleanup | Leave meet/docs | Peers removed; `/leave` succeeds |
| N9 | Collab signaling API | `pnpm test:collab-api` | join/poll/send/leave return JSON |
| N10 | Meet signaling API | `pnpm test:meet-api` | guest join/poll/leave on `/meet/*` return JSON |
| N11 | Meet mesh smoke | Two tabs, same room, `?rtcDebug=1` | `[rtc][meet][…][pc-connected]`; inbound RTP bytes increase; remote tile shows A/V; outbound offer SDP includes `m=audio` and `m=video`; no `Illegal invocation` in console |
| N12 | Guest meet control | Guest knock URL (no auth) → host admits | Guest reaches `in-call`; knock/admit chat control works; guest `sessionKey` on poll/chat; media presence toggles propagate |

## Shared hosting notes

- Signaling is **HTTP poll only** (Apache + mod_php); no WebSocket daemon required.
- TURN must be **external** (coturn on VPS); STUN-only is insufficient for ~20% of networks.

## SDP sanitizer (2026-10-04)

The pair that required stripping is Safari (WebKit) against Chromium. Unit tests in `meet-rtc-sdp.test.ts` cover it:

- Chromium parsing a Safari description strips `a=extmap-allow-mixed`, `a=rtcp-rsize`, and plan-b `a=ssrc`, and keeps RTX and Opus RED.
- Safari parsing a Chromium description strips RTX and Opus RED, and keeps those session lines.
- H.265/HEVC, AV1, and VP9 are stripped for every parser. Inbound Opus fmtp gains `usedtx=1`.

N0–N12 were not re-executed here. This environment has no second browser and no TURN server, so this note is not a pass of the manual matrix.
