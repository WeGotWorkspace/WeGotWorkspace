# RTC network matrix (manual audit)

Enable browser logging with `?rtcDebug=1` on meet or docs URLs. Logs use prefix `[rtc][channel][peerId][event]`.

## Prerequisites

- Admin **Meet** settings: valid STUN URL(s) and external TURN (`turn:host:3478?transport=udp` format).
- TURN uses a shared secret (`coturn` `use-auth-secret`). There are no static credentials.
- Trickle ICE test page shows a **relay** candidate row before go-live.
- Docker dev stack or shared-hosting install with `/api/v1/rooms/*` reachable.

## Scenarios

| ID | Scenario | Steps | Pass criteria | Manual |
| -- | -------- | ----- | ------------- | ------ |
| N0 | Direct LAN | Two browsers, same network, meet room | `[rtc][meet][…][selected-pair]` shows `host` or `srflx`; A/V connected | |
| N1 | Guest meet TURN | Guest join URL (no auth) | Configuration returns `turnAvailable` only. Credentials come from `POST /rooms/{id}/relay`. A knocking peer receives 403 | |
| N2 | Docs collab | Two users, same doc | Data channel open; Yjs sync; `[rtc][collab][…][dc-open]` | Passed 2026-10-07/08 ([M1](#manual-runs-2026-10-07-08), [M3](#manual-runs-2026-10-07-08)) |
| N3 | Force relay (debug) | Add `?rtcForceRelay=1` or set `VITE_WGW_RTC_FORCE_RELAY=1` | `iceTransportPolicy: relay` in `pc-created` log; selected pair `relay` | |
| N4 | Relay fallback | Symmetric NAT or firewall block direct | `[relay-fallback-start]` then `[relay-fallback-offer-sent]` or connected | |
| N5 | Hotspot | Phone hotspot client | Session connects (often via `relay`); no endless `failed` | |
| N6 | Unknown peer recovery | Docs: stale tab after server prune | `[peer-recover-start]` / `[peer-recover-success]` | |
| N7 | Poll steady | In-call 5+ minutes | Poll continues; no HTML error responses | |
| N8 | Leave cleanup | Leave meet/docs | Peers removed; `/leave` succeeds | |
| N9 | Collab signaling API | `pnpm test:collab-api` | join/poll/send/leave return JSON | |
| N10 | Meet signaling API | `pnpm test:meet-api` | Guest join/poll/leave on `/api/v1/rooms/*` return JSON | |
| N11 | Meet mesh smoke | Two tabs, same room, `?rtcDebug=1` | `[rtc][meet][…][pc-connection-state]` has `connectionState` `connected`; inbound RTP bytes increase; remote tile shows A/V; outbound offer SDP includes `m=audio` and `m=video`; no `Illegal invocation` in console | |
| N12 | Guest meet control | Guest knock URL (no auth) → host admits | Guest reaches `in-call`; knock/admit chat control works; guest `sessionKey` on poll/chat; media presence toggles propagate | |
| N13 | iOS Safari remote audio | **Human-only.** Join a Meet call in iOS Safari | Remote audio stays silent until a user gesture, then plays | |
| N14 | Installed PWA camera | **Human-only.** Open the installed PWA in standalone mode and join a Meet call | Camera permission succeeds in standalone mode and local video shows | |
| N15 | Resume from background | **Human-only.** On iOS Safari and on the installed PWA, background a Meet call or Docs session, then return | The client polls immediately and restarts ICE; the call or document stays connected | |

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

<a id="manual-runs-2026-10-07-08"></a>

## Manual runs — 2026-10-07/08

Build under test was `integration/rtc-hardening` after #1192 (merge `9deca552`) plus the idle-backoff commits. Debug URL flags were `?rtcDebug=1`, and `?rtcForceRelay=1` where noted.

### Passed

| # | Setup | Channel | Path | Result |
|---|---|---|---|---|
| M1 | Mac Chrome, wifi ↔ second user on 4G | Meet, chat, Docs | Direct (STUN), no TURN | Connected within a few seconds. Switching between Meet, chat and Docs is instant: Docs opens a per-document link channel on the principal peer connection (`dc-open` with `via: link`). Live carets and edits arrive immediately. |
| M2 | iPhone Safari, 4G ↔ Mac Chrome, wifi | Docs | Forced TURN (`rtcForceRelay=1`), coturn | Principal link stays on relay (`iceTransportPolicy: relay`); Docs collaboration rides link channels on that connection. Live carets and edits work. |
| M3 | Two users, two windows on one Mac | Docs | Direct (host) | After #1192: the document loads on refresh, there is one collab peer id per tab, no echo storm, and carets and edits are live in both directions. |
| M4 | Two users, two windows on one Mac | Meet | Direct | Stable (user report, 2026-10-07). |

### Open, not yet reproduced

| # | Setup | Observation |
|---|---|---|
| F1 | Mac Chrome, wifi ↔ laptop on 4G, Docs, `rtcForceRelay=1` | Flaky across refreshes. The wifi side was the non-initiator (`lowerId` rule) and never received an offer. Edits went over the HTTP fallback only. It did not recur in M2. A likely related cause, a relay-mode PC created without TURN credentials, is being fixed in `fix/rtc-force-relay-all-channels`. Re-run after that fix. |

### Still to run (B8)

- Forced relay for longer than one TTL (over 60 min with `WGW_RTC_TURN_TTL_SECONDS` at its default, or shortened for the run), including credential refresh and ICE restart. **Run this after** `fix/rtc-force-relay-all-channels`, so that presence and Docs both stay on relay.
- A network switch mid-session (wifi → 4G) on Meet and on Docs.
- A UDP-blocked network that needs TURN over TCP/TLS (`turn:…?transport=tcp` / `turns:…:443`).
- Symmetric NAT on both sides.
- The chaos "two browsers" scenario with `WGW_CHAOS_ALLOW_MDNS=1`.

N4, N5, and N13–N15 were not re-executed. N4 and N5 need a second network (symmetric NAT or a phone hotspot). N13–N15 need a person on iOS Safari and the installed PWA. This note is not a pass of those scenarios. The 2026-10-07/08 manual runs passed N2 only. Still open, with no passing manual run: N0, N1, N3, N4, N5, N6, N7, N8, N9, N10, N11, N12, N13, N14, and N15. N3 stays open because M2 covered only a short collab relay window and F1 was not reproduced as a stable failure. The Still to run (B8) items were not run.
