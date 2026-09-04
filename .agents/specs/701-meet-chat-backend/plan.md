# Meet chat backend + live workspace

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `meet_chat_backend_wiring_23974c5d`. Epic #701; child Tasks #702–#709.

## Goal

Persist Meet channels/messages on the Sabre CalDAV + VJOURNAL stack (full ACL/sharing reuse), expose them via REST + `urn:wgw:jmap:chat`, wire the built `MeetWorkspace` to live data via the hybrid-Dexie pattern, and flip live `/meet` to the new shell with calls on existing WebRTC signaling — plus DMs, server-enforced knock policy, typing indicators, old-shell retirement, and the calendar conferencing-link picker.

## Non-goals

- CRDT for messages; persistent guest messages; external unfurl service
- Moderation-style deletion of others' messages (author-only in v1)
- Hiding Notes collections from DAV; `lib/rtc` signaling / SDP changes

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

1. **Chunk A** (OpenAPI) blocks everything — do first.
2. Then **B ∥ C** (channels, messages backends); **E** after A (mock-testable before D).
3. **D** (JMAP) after B + C. **H** (join policy) after B.
4. **F** (live workspace + flip) after C + E. **G** (DMs) after B + C, parallel with F. **L** (calendar picker) after B, parallel with F/G.
5. **I** (knock UI) after F + H. **K** (typing) after F, parallel with G/I.
6. **J** (retire old shell) after F + G + I. **V** last.

## Chunks

### Chunk A: OpenAPI contract

- **id:** `chunk-a-openapi`
- **Skill:** api
- **Task:** #702
- **Inputs:** notes schemas (`openapi/schemas/notes/`), `MeetChannel`/`ChatMessage` frontend types
- **Done when:** `openapi/schemas/chat/` fragments (channels, messages, reactions, read markers, changes) wired into `openapi.json`; `pnpm --filter @wgw/api typegen` clean; `OpenApiRouteContractTest` red-green plan exists (route stubs if parity demands)
- **Verify with:** typegen diff clean; `composer test -- --filter OpenApi`; `pnpm --filter @wgw/apps typecheck`
- **Parallel with:** none (blocks everything)

### Chunk B: Channels backend

- **id:** `chunk-b-channels`
- **Skill:** api
- **Task:** #702
- **Inputs:** A; `NotebookRepository` (production-proven precedent); `note_stars` migration pattern
- **Done when:** **opens with the changes-spike** — failing feature test proving a `chat-` collection write surfaces via `getChangesForCalendar` incl. paging at volume; then `ChatChannelRepository`, `chat_channel_meta` migration, channels controller + shareWith/groupSlug transfer, **DAV-exposure filter** (prefix-configurable home-set exclusion + direct-access deny on the DAV server's backend instance; regression test asserts the `chat-`/`dm-` deny *and* the `notes-` allow with an in-test comment explaining the deliberate asymmetry); feature tests (ACL matrix cloned from notebook sharing tests)
- **Verify with:** `composer test` feature suites; `pnpm test:api-done-gate`
- **Parallel with:** C

### Chunk C: Messages backend

- **id:** `chunk-c-messages`
- **Skill:** api
- **Task:** #702
- **Inputs:** A; `NoteJournalConverter`
- **Done when:** `ChatMessageJournalConverter` (round-trip tests), ULID message ids, message repository, send/edit/delete/react/read-marker endpoints (`SEQUENCE` untouched by reactions; author-only edit/delete), `chat_read_markers` migration with `(ts, uid)` ordering; feature tests
- **Verify with:** `composer test` feature suites; `pnpm test:api-done-gate`
- **Parallel with:** B

### Chunk D: JMAP capability

- **id:** `chunk-d-jmap`
- **Skill:** api
- **Task:** #703
- **Inputs:** B + C; Notes JMAP recipe (`JmapMethodDispatcher::METHODS`, capability provider, `JmapAccountStateCodec`)
- **Done when:** `urn:wgw:jmap:chat` with `ChatChannel/get|changes|set`, `ChatMessage/get|changes|set`; state fan-out over channel collections; `tests/Feature/Jmap/` incl. `cannotCalculateChanges` resync
- **Verify with:** `composer test -- --filter Jmap`; `pnpm test:api-done-gate`
- **Parallel with:** E (E is mock-testable before D lands)

### Chunk E: Live client + hybrid ops

- **id:** `chunk-e-client`
- **Skill:** apps-ui, workspace
- **Task:** #704
- **Inputs:** A (generated types); Notes/Tasks hybrid pattern
- **Done when:** `meet-chat.ts` REST client, `meet-chat-hybrid-operations.ts` (Dexie cache + outbox, full-history backfill then incremental), `meet-chat-jmap-inbound` (~3–5s poll), `meet-chat-api-source.ts` + `use-meet-chat-api.ts` (mock vs live via `wgwLiveApiEnabled()`); Vitest on hybrid ops + outbox replay
- **Verify with:** targeted Vitest; `pnpm --filter @wgw/apps typecheck`
- **Parallel with:** B, C, D

### Chunk F: Live MeetWorkspace + route flip

- **id:** `chunk-f-liveapp`
- **Skill:** workspace, meet
- **Task:** #704
- **Inputs:** C + E; `useMeetRtc` + suite call store
- **Done when:** live `MeetApp` composes chat ops + RTC call stage + DM rail; `startCall` → reservation + `useMeetRtc`; `/meet` flipped in `wegotworkspace-routes.tsx`; `/meet/join` keeps `MeetGuestChannel`; **screen-share parity explicit:** remote shared screen renders in all stage layouts (collapsed / expanded / fullscreen / spotlight) and the guest view
- **Verify with:** targeted Vitest + stories; two-browser manual smoke on :5174
- **Parallel with:** G, H, L

### Chunk G: DM provisioning

- **id:** `chunk-g-dms`
- **Skill:** api, apps-ui
- **Task:** #706
- **Inputs:** B + C
- **Done when:** DM collections auto-provision on first message (`dm-{a}-{b}` sorted, peer write invite, hidden from Channels sidebar), unread badges from read markers, directory-driven DM send
- **Verify with:** feature tests + targeted Vitest
- **Parallel with:** F, H, L

### Chunk H: Join policy backend

- **id:** `chunk-h-join-policy`
- **Skill:** api
- **Task:** #705
- **Inputs:** B; `CollabJoinAuthorizer` precedent; `MeetSignalingService`
- **Done when:** `MeetChannelJoinPolicy` in `MeetSignalingService`: ACL member → direct join as host, never knocks; non-member (guest or internal) → server-enforced knock; feature tests for the member / internal non-member / guest join matrix
- **Verify with:** `composer test` signaling feature tests
- **Parallel with:** F, G, L

### Chunk I: Knock/admit UI in new workspace

- **id:** `chunk-i-knock-ui`
- **Skill:** meet, apps-ui, storybook
- **Task:** #705
- **Inputs:** F + H; `meet-knock-badge.tsx`, admit/deny control messages
- **Done when:** knock/admit ported into `MeetCallStage` / call chrome; pending-knock list for hosts; knocker waiting state; mock-tier stories for knock pending / admitted / denied
- **Verify with:** stories compile + Storybook coverage
- **Parallel with:** K

### Chunk K: Typing indicators over presence-core

- **id:** `chunk-k-typing`
- **Skill:** meet, apps-ui
- **Task:** #707
- **Inputs:** F; `presence-core` (#690, on `main`)
- **Done when:** data-channel typing signals wired into composer/chat column; new typing-indicator UI (does not exist yet); debounce/expiry semantics; mock-tier stories; never touches the persistence/sync path
- **Verify with:** targeted Vitest + stories
- **Parallel with:** G, I

### Chunk L: Calendar conferencing-link picker

- **id:** `chunk-l-calendar-picker`
- **Skill:** workspace, apps-ui
- **Task:** #709
- **Inputs:** B (meeting channels carry `room_code`); calendar event form + existing generate-link flow
- **Done when:** calendar event form can pick an existing meeting-kind Meet channel as the event's conferencing link, alongside ad-hoc generate-link; mock-tier stories
- **Verify with:** targeted Vitest + calendar stories
- **Parallel with:** F, G, H

### Chunk J: Retire old Meet shell

- **id:** `chunk-j-cleanup`
- **Skill:** meet, document
- **Task:** #708
- **Inputs:** F + G + I (guest flow fully on new stage)
- **Done when:** `MeetCallWorkspace` (+ props), `meet-lobby-pane`, `meet-lobby-status-card`, `meet-room-pane`, `meet-room-status-bar`, old flat `meet-chat-pane` and their stories deleted; shared pieces kept (`meet-control-messages`, device components, peer tile, knock badge); `workspace-shells.md`, meet skill, `index.ts` exports updated; Storybook coverage baseline adjusted
- **Verify with:** Storybook coverage + `pnpm --filter @wgw/apps typecheck`
- **Parallel with:** none (last before V)

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** testing
- **Task:** all (#702–#709)
- **Done when:** verifier `PASS` or `PASS_WITH_NITS` per [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md); `pnpm test:api-done-gate` + `pnpm test:apps-done-gate` (or MCP done-gate tools); verify-issue on the child Tasks; parent ran [done-checklist](../../skills/developer/done-checklist.md)
- **Verify with:** done gates + verify-issue
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI first → failing feature test → implement ([testing/test-first.md](../../skills/testing/test-first.md)); ACL matrix tests (owner / sharee / group member / dismissal) cloned from notebook sharing tests; VJOURNAL round-trip converter tests; JMAP changes tests incl. `cannotCalculateChanges` resync
- [ ] Apps: Vitest on hybrid ops + outbox replay; Storybook stays mock-tier; `pnpm test:apps-done-gate` before push
- [ ] Manual: two-browser live smoke on :5174 (send/edit/react/thread across users, DM, start call from channel; screen share from each browser visible on the other in every stage layout; join matrix: member no-knock, internal non-member knocks, guest knocks, any member admits)

## Doc updates

- `packages/apps/docs/workspace-shells.md` — Meet row after route flip
- `.agents/skills/meet/SKILL.md` — live wiring notes
- `docs/architecture/` — chat storage decision (VJOURNAL trade + DAV filter) if requested
