# RTC cross-app connection optimization

Derived from [spec.md](./spec.md). Full source plan: `~/.cursor/plans/rtc_cross-app_verbeteringen_9e306e09.plan.md`.

## Goal

Phased RTC improvements: collab-join authorization (security, first), Meet call persistence + poll efficiency, collab linger + gossip discovery, principal room kind.

## Non-goals

- External share-session tokens on collab join; phase 4 cross-window leadership (#695); SFU/TURN infra.

## Affected packages

- packages/api, packages/apps

## Dependencies

1. Phase 0 (security) before all optimization work.
2. Phase 1 items are independent of each other.
3. Phase 2 depends on phase 1 poll changes only loosely (can parallel).
4. Phase 3a after 0; 3b only after 3a go/no-go.

## Chunks

### Chunk 0: collab-join authorization

- **id:** `collab-join-authz`
- **Skill:** api, testing
- **Inputs:** `DocCollabSignalingService::join`, `CollabRoomPolicy`, `DriveShareAuthorizer`, `NoteRepository`, room shapes per spec
- **Done when:** failing-first `CollabJoinAuthorizationTest` proves the gap (docs path + note UID), then passes with the room-shape discriminator + access check; pre-existing collab/meet tests adjusted and green
- **Verify with:** `vendor/bin/phpunit tests/Feature/Collab tests/Feature/Meet` in `packages/api`
- **Parallel with:** none (blocks the rest)

### Chunk 1a: Meet persistent call (apps)

- **id:** `meet-persistent-call`
- **Skill:** workspace, meet
- **Inputs:** `MeetRtcSession`, `wegotworkspace-app.tsx`, existing `meet-pip` CSS
- **Done when:** call survives route change, mini-player outside `/meet`, per-tab call + BroadcastChannel "call active" signal
- **Verify with:** `pnpm test` in `packages/apps` (+ apps done gate before handoff)
- **Parallel with:** `poll-efficiency`

### Chunk 1b: poll efficiency

- **id:** `poll-efficiency`
- **Skill:** api, apps-ui
- **Inputs:** `RtcPeerMesh` (`peer-mesh.ts`), events poll endpoint
- **Done when:** visibility backoff only for tabs without active connections; conditional "nothing new" poll response (roster version + since)
- **Verify with:** apps Vitest + API feature tests on poll
- **Parallel with:** `meet-persistent-call`

### Chunk 2: collab linger + gossip

- **id:** `collab-linger-gossip`
- **Skill:** workspace
- **Inputs:** `use-docs-collab.ts`, collab DC envelope
- **Done when:** grace period (below 30 s server TTL) on route change with poll running; gossip hint → `connectTo` + poll kick (Meet excluded)
- **Verify with:** apps Vitest
- **Parallel with:** none (after phase 1)

### Chunk 3a: principal room kind

- **id:** `principal-room`
- **Skill:** api, workspace
- **Inputs:** `RoomIdCodec` (`p_` prefix), `RtcSignalingPolicy::principal()`, `principal_peers`/`principal_messages` migrations, `PrincipalSignalingService`, suite-level principal mesh
- **Done when:** backend room kind + group-membership join check; frontend presence/chat/typing over principal mesh (eager desktop, lazy mobile)
- **Verify with:** API feature tests + apps Vitest
- **Parallel with:** none

## Test plan

- [ ] Phase 0: failing feature tests first (`CollabJoinAuthorizationTest`), then implement, then Collab + Meet suites green
- [ ] Phase 1+: red-green per chunk; full done gates run by the verification agent before handoff

### Phase 3b verification (folded into `principal-reuse`) — **done**

Live verified 2026-09-04 (user-confirmed). Keep `?rtcDebug=1` as a **number** (never `"1"`). Isolated cookies: cursor-ide-browser vs Chrome DevTools. Live URL: `http://127.0.0.1:5173/docs?file=groups%2Fadministrators%2Fteam-notes.md&rtcDebug=1`. Creds: `admin` / `storybook-dev`, `wouter` / `storybook-dev`. SPA navigation after login (do not hard-reload the doc).

1. [x] **Reuse-hit confirmation.** Both users log in, wait until the principal mesh is up, one opens the doc, the other follows. Console: `[rtc][collab][reuse-hit]` then `[dc-open]` `{ reused: true }` — not a fresh ICE round.
2. [x] **Bidirectional sync over the reused channel.** A→B and B→A Yjs updates on the reused DC; sender must not apply their own echo.
3. [x] **Silent fallback when the principal link drops mid-session.** Drop principal PC/DC during active collab → no UI hiccup; sync continues on fresh ICE. Log: `reuse-miss` `{ reason: "principal-link-gone" }`, `datachannel-open` `{ reused: false }`.
