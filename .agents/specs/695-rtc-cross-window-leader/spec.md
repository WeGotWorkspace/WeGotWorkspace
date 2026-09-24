Source: #695 (body-hash: 67649a17)
Goal: #686

# RTC Phase 4 — cross-window principal-mesh leader

Technical translation of Task [#695](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/695). Continues the RTC optimization arc from `.agents/specs/000-rtc-connection-optimization/` (Phases 0–3b landed in PR #690).

## Goal

Ensure one **principal mesh dial per signed-in user** across browser windows/tabs (including PWA multi-window): elect a sticky BroadcastChannel leader, have followers proxy presence/chat/typing envelopes through that leader, and hand off with a documented reconnect blip when the leader closes.

## Non-goals

- SFU / media-server work (Goal #580)
- Transferring `RTCPeerConnection` across windows (platform-impossible)
- Reworking Meet call BroadcastChannel “call active in another tab” from #690
- Cross-window collab principal-reuse of the leader’s data channels (followers fall back to per-room ICE; same-tab reuse from #690 remains)
- New UI for presence/chat beyond the #690 foundation

## Affected packages

- `packages/apps` — `presence-core` tab coordinator + PresenceStore wiring; short kernel/README note on handoff blip
- Docs under this spec (go/no-go decision note)

## Technical constraints

- Pattern: `docs-collab-tab-sync.ts`, with **deliberate deviations**:
  - Channel name: `wgw.principal.tab` (workspace-wide; not per-room)
  - **Sticky election:** resign only on `pagehide` / close / explicit stop — **not** on `visibilitychange` hide
  - Keep current leader while still present (do not bounce to a newly visible tab)
  - Request/response (or fire-and-forward) **envelope proxy** for follower windows
- Leader owns the real `PresenceRtcSession` / principal `RtcPeerMesh` join; followers must not call signaling join for the principal room
- On leader close: follower elects, joins, re-dials peers — expect **~0.5–2 s** shared-layer blip; document it
- Go/no-go: ship only after multi-window / PWA usage justifies complexity, **or** record an explicit decision to proceed in this spec

## Edge cases

- BroadcastChannel unavailable → each window behaves as sole leader (current single-window path)
- Leader becomes hidden but stays open → remains leader; followers keep proxying
- Leader crash without `pagehide` → stale ping timeout elects a new leader
- Multiple windows cold-start together → deterministic sticky election (lowest active `tabId` until one sticks)
- Lazy (mobile) join mode: only the leader performs join; followers still sync roster/chat via proxy once leader is online
- Collab open in a follower tab: no principal links in that window → reuse miss → fresh collab ICE (acceptable Phase 4 scope)

## Go / no-go

**Status:** implementing under explicit Task #695 AC; **product ship gate** still open — confirm multi-window / PWA N× dial pain justifies the complexity before merge to `main`, or add an explicit “proceed” note here after judgment.
