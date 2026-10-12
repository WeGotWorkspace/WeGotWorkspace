# RTC network matrix (manual audit)

Enable browser logging with **Admin → Real-time collaboration → Detailed connection logs** (or a Playwright test override). Logs use prefix `[rtc][channel][peerId][event]`.

## Prerequisites

- Admin **Meet** settings: valid STUN URL(s) and external TURN (`turn:host:3478?transport=udp` format).
- TURN uses a shared secret (`coturn` `use-auth-secret`). There are no static credentials.
- Trickle ICE test page shows a **relay** candidate row before go-live.
- Docker dev stack or shared-hosting install with `/api/v1/rooms/*` reachable.

## Scenarios

| ID | Scenario | Steps | Pass criteria | Manual |
| -- | -------- | ----- | ------------- | ------ |
| N0 | Direct LAN | Two browsers, same network, meet room | `[rtc][meet][…][selected-pair]` shows `host` or `srflx`; A/V connected | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N1 | Guest meet TURN | Guest join URL (no auth) | Configuration returns `turnAvailable` only. Credentials come from `POST /rooms/{id}/relay`. A knocking peer receives 403 | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N2 | Docs collab | Two users, same doc | Data channel open; Yjs sync; `[rtc][collab][…][dc-open]` | Passed 2026-10-07/08 ([M1](#manual-runs-2026-10-07-08), [M3](#manual-runs-2026-10-07-08)); reconfirmed 2026-10-12 |
| N3 | Force relay (debug) | Admin **Always use the TURN relay**, or `VITE_WGW_RTC_FORCE_RELAY=1`, or a Playwright `forceRelay` override | `iceTransportPolicy: relay` in `pc-created` log; selected pair `relay` | Meet+Docs via Admin force-relay on online release ([M6](#manual-runs-2026-10-12-online)); earlier Meet-via-override in [M5](#manual-runs-2026-10-12). Docs+iPhone 4G row still optional |
| N4 | Relay fallback | Symmetric NAT or firewall block direct | `[relay-fallback-start]` then `[relay-fallback-offer-sent]` or connected | |
| N5 | Hotspot | Phone hotspot client | Session connects (often via `relay`); no endless `failed` | Passed 2026-10-12 online ([M6](#manual-runs-2026-10-12-online)) |
| N6 | Unknown peer recovery | Docs: stale tab after server prune | `[peer-recover-start]` / `[peer-recover-success]` | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N7 | Poll steady | In-call 5+ minutes | Poll continues; no HTML error responses | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N8 | Leave cleanup | Leave meet/docs | Peers removed; `/leave` succeeds | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N9 | Collab signaling API | `pnpm test:collab-api` | join/poll/send/leave return JSON | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N10 | Meet signaling API | `pnpm test:meet-api` | Guest join/poll/leave on `/api/v1/rooms/*` return JSON | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N11 | Meet mesh smoke | Two tabs, same room, detailed connection logs on | `[rtc][meet][…][pc-connection-state]` has `connectionState` `connected`; inbound RTP bytes increase; remote tile shows A/V; outbound offer SDP includes `m=audio` and `m=video`; no `Illegal invocation` in console | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N12 | Guest meet control | Guest knock URL (no auth) → host admits | Guest reaches `in-call`; knock/admit chat control works; guest `sessionKey` on poll/chat; media presence toggles propagate | Passed 2026-10-12 ([M5](#manual-runs-2026-10-12)) |
| N13 | iOS Safari remote audio | **Human-only.** Join a Meet call in iOS Safari | Remote audio stays silent until a user gesture, then plays | Skipped as N/A 2026-10-12 ([M6](#manual-runs-2026-10-12-online)): Join is already a user gesture |
| N14 | Installed PWA camera | **Human-only.** Open the installed PWA in standalone mode and join a Meet call | Camera permission succeeds in standalone mode and local video shows | Passed 2026-10-12 online ([M6](#manual-runs-2026-10-12-online)) |
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
| M1 | Mac Chrome, wifi ↔ second user on 4G | Meet, chat, Docs | Direct (STUN), no TURN | Connected within a few seconds. Switching between Meet, chat and Docs is instant: Docs reuses the presence link (`reuse-hit`, `dc-open reused`). Live carets and edits arrive immediately. |
| M2 | iPhone Safari, 4G ↔ Mac Chrome, wifi | Docs | Forced TURN (`rtcForceRelay=1`), coturn | Collab relay link `connected` about 0.5 s after the offer (`iceTransportPolicy: relay`). Live carets and edits work. **Caveat:** about 3 s later Docs switched to the presence link, which ran **direct** because presence ignores `rtcForceRelay`. So M2 covers only a short relay window. |
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

N4, N5, and N13–N15 were not re-executed in 2026-10-07/08. See [M5](#manual-runs-2026-10-12) for the 2026-10-12 local pass of N0–N3 (Meet), N6–N12.

<a id="manual-runs-2026-10-12"></a>

## Manual runs — 2026-10-12

Tracked on [#1204](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1204). Build under test: local Vite + API on `main` after [#1214](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1214) (RTC admin diagnostics). Debug via Admin **Detailed connection logs** (URL `rtcDebug` / `rtcForceRelay` params removed). Console filter: `rtc`.

### Passed (M5)

| ID | Setup | Channel | Path | Result |
|---|---|---|---|---|
| N0 | Two browsers, same LAN | Meet | Direct | `selected-pair` host/srflx; `pc-connection-state` connected; A/V OK |
| N1 | Guest knock room `xn4f-396b-4yau` | Meet | TURN credentials | Knocker `POST …/relay` **403**; post-admit **200** `issued`. After clearing a leftover guest `forceRelay` override: both peers `iceTransportPolicy: all`, connected, A/V OK |
| N2 | Two users, same doc | Docs | Direct | Reconfirmed `dc-open` + Yjs sync (already green from M1/M3) |
| N3 | Meet `HC5CTEFTGW` ↔ `SN2ZGW6KNP` | Meet | Forced relay via `__WGW_RTC_TEST_OVERRIDES__.forceRelay` | Both `iceTransportPolicy: relay`, relay candidates, connected, A/V OK. Admin force-relay did not reach Meet until [#1220](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1220) (signed-in bearer). Principal under the same override is out of scope for N3 |
| N6 | Docs; debugger-pause prune | Docs | Direct | Poll 404 → `[peer-recover-start]` / `[peer-recover-success]`; `dc-open reused` + sync. Relay POST 503 expected without coturn |
| N7 | Docs soak ~7+ min on `groups/administrators/Shared.md` | Docs | Direct | Steady `poll` / `204` / `poll-unchanged`; tab-hide → 60s then `visibility-poll-restore`; `leave` 200. No HTML / no `poll-failed` |
| N8 | Leave Meet/Docs | Meet / Docs | — | Leave cleanup 2xx |
| N9 | `pnpm test:collab-api` | Collab API | — | Pass |
| N10 | `pnpm test:meet-api` | Meet API | — | Pass |
| N11 | Two tabs, same room | Meet | Direct | Mesh smoke: connected + A/V |
| N12 | Ad-hoc `j6hb-2hq2-ssqf` | Meet guest | Direct | Knock → `sessionKey` on poll → admit re-join → connected. Transient knocker `POST …/messages` 403 before admit is expected |

### Still open after M5

Superseded in part by [M6](#manual-runs-2026-10-12-online). See that section for the current open list.

### Bugs found in M5

| Issue | Status |
|---|---|
| [#1218](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1218) signed-in Meet bootstrap without bearer | Fixed in [#1220](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1220) (`55c506e`) |
| [#1217](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1217) host mute waited on ~4s idle poll | Fixed in [#1221](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1221) (`b704ee8`) |
| [#1219](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1219) guest bootstrap still has no STUN/TURN | Open — needs post-join `sessionKey` refetch + mid-session ICE replace |

<a id="manual-runs-2026-10-12-online"></a>

## Manual runs — 2026-10-12 (online release, M6)

Tracked on [#1204](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1204). Build under test: operator’s online instance on the latest release (includes [#1214](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1214), [#1220](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1220), [#1221](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/1221)). Admin: TURN configured; detailed connection logs on. Console filter: `rtc`.

### Passed (M6)

| ID | Setup | Channel | Path | Result |
|---|---|---|---|---|
| N5 | Desktop wifi ↔ peer on phone hotspot | Meet | Force-relay **off** (TURN still configured) | `NBY2NQ34MY` ↔ `XUL9BW6TAC`; `selected-pair` → `connectionState: connected` |
| Network switch | Mid-call network change (no refresh) | Meet (+ principal) | Force-relay **off** | Meet `695XZ65MYL` ↔ `XHA7DJYYAN`: brief `disconnected` → `connected`; pair `host`/`prflx`; media recovered. Principal briefly `failed` then `relay-fallback` (`wouter-c09373` ↔ `wouter2-b04e8d`) |
| N3 Meet | Two peers; Admin **Always use the TURN relay** on; no test override | Meet | Forced relay (Admin) | `HGUL36HUVB` ↔ `QD5JUGSCLG`: `controller-init` `forceRelay: true`, `stunCount: 4`; Meet `pc-created` `mode` / `iceTransportPolicy: relay` → `connected`. Principal also `relay` (`wouter-07cdcc`) — Admin path works after #1220 |
| N3 Docs | Two signed-in tabs; Admin force-relay on | Docs collab | Forced relay (Admin) | Collab `202a03062a3301b4` ↔ `e83f5ba71eeada72`: `pc-created` relay → `connected`; carets both ways (fast) |
| N14 | Installed PWA, standalone | Meet | — | Camera permission succeeds; local video shows |

### Prior local pass still standing (M5)

N0, N1, N2, N3 (Meet via override), N6–N12 — see [M5](#manual-runs-2026-10-12).

### Skipped / not proven (M6)

| ID | Why |
|---|---|
| N4 | Meet stayed `host`/`prflx` after network switch; no Meet `relay-fallback-*`. Needs real symmetric NAT |
| Long TTL | Operator could not wait / lower `WGW_RTC_TURN_TTL_SECONDS` |
| UDP-blocked TCP TURN | Operator could not configure TCP/TLS TURN + blocked UDP |
| N3 Docs + iPhone 4G | Optional #1204 row; same-machine Docs N3 already green |
| N13 | Skipped as N/A: Join is already a user gesture, so “silent until tap” is not a realistic product path |
| N15 | Not run (background resume on iOS Safari + installed PWA) |
| `pnpm test:rtc-relay` | Not run against this host |

### Combined scorecard (M5 + M6)

| ID | Status |
|---|---|
| N0 | pass (M5) |
| N1 | pass (M5) |
| N2 | pass (M5) |
| N3 Meet | pass — Admin force-relay on online release (M6); earlier override-only (M5) |
| N3 Docs | pass — Admin force-relay (M6) |
| N4 | not proven |
| N5 | pass (M6) |
| N6–N12 | pass (M5) |
| Network switch | pass (M6) |
| N13 | skip / N/A |
| N14 | pass (M6) |
| N15 | not run |
| Long TTL / TCP TURN | not run |
