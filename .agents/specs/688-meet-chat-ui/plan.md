# Meet as chat + voice (frontend / Storybook)

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `meet_chat_frontend_c1e36185`.

## Goal

Replace Meet’s lobby-first custom shell **in Storybook** with the same **split** workspace other apps use: channel sidebar, chat as the main column, optional resizable (and fullscreen) call stage. Guests land on a **stripped channel** (chat + call, no other channels), built from today’s lobby/room components.

Live `/meet` stays on the current custom lobby/room so the parallel WebRTC refactor is not blocked. The new workspace is an exported, mock-wired product surface ready to mount later.

## Non-goals

- API, OpenAPI, Sabre collections, message persistence, unfurl fetchers
- `lib/rtc` / signaling / SDP / poll cadence
- File attachments, 1:1 DMs, custom emoji, searchable full emoji picker
- Switching the live `MeetApp` route in this phase
- Refactoring Docs comments onto the new chat primitives

## Affected packages

- packages/apps | docs (workspace-shells + meet skill in verify)

## Dependencies

1. **file-issues-spec** then **types-fixtures** then **shell-channels**.
2. Then **B ∥ C ∥ E** (`chat-primitives`, `link-previews`, `call-stage-guest`).
3. **chat-threads** after B.
4. **compose-workspace** after A–E.
5. **docs-verify** last.

## Chunks

### Chunk 0: File issues + spec

- **id:** `file-issues-spec`
- **Skill:** developer, plan-feature, git-workflow
- **Inputs:** Goal outcome; Cursor plan
- **Done when:** Goal #686 (`type:goal`, `area:meet`) on Product Project at Identified; Epic #687 parented under the Goal (not on Product Project); Task #688 parented under the Epic with implementable `- [ ]` AC; `.agents/specs/688-meet-chat-ui/{spec,plan,tasks}.md` with `Source: #688 (body-hash: …)` and `Goal: #686`
- **Verify with:** `gh issue view` parents; spec header hash
- **Parallel with:** none

### Chunk T: Types, fixtures, stub operations

- **id:** `types-fixtures`
- **Skill:** workspace
- **Inputs:** Notes/Tasks collection types; current `meet-types.ts`
- **Done when:** `MeetChannel` / `ChatMessage` types; bootstrap + fixtures; stub operations; Vitest for URL/preview mapping and `partitionOwnedAndShared` on channels
- **Verify with:** targeted Vitest
- **Parallel with:** none

### Chunk A: Split shell + channel sidebar

- **id:** `shell-channels`
- **Skill:** workspace
- **Inputs:** T; Tasks workspace; `TaskProjectDialog`
- **Done when:** `MeetCallWorkspace` rename of today’s shell; new `MeetWorkspace` split layout with channel sections + create/edit dialog; empty main; mock-tier `Apps/Meet` Default story; CSS full-bleed like Docs
- **Verify with:** targeted Vitest + `Apps/Meet` Default story compiles
- **Parallel with:** none (unblocks E)

### Chunk B: Chat primitives

- **id:** `chat-primitives`
- **Skill:** apps-ui + storybook
- **Inputs:** T; TextEditor `inline`; DocsCollabReactions pattern
- **Done when:** `chat-ui` message/list/composer/mentions/reactions/edit/delete; `Shared/Chat/*` mock-tier stories; Vitest for mention parse / send-on-enter helpers
- **Verify with:** Vitest + Shared/Chat stories
- **Parallel with:** C, E

### Chunk C: Link previews

- **id:** `link-previews`
- **Skill:** apps-ui + storybook
- **Inputs:** T; FilePreview; DocsFilePreview
- **Done when:** internal + external `ChatLinkPreview`; composer/list attach previews from fixture unfurl map; stories for docs/drive/external/missing
- **Verify with:** Shared/Chat preview stories
- **Parallel with:** B, E

### Chunk D: Threads

- **id:** `chat-threads`
- **Skill:** apps-ui + workspace
- **Inputs:** B
- **Done when:** `ChatThreadPanel`; Meet uses `panel` when idle and `SideDrawer` when a call is open; stories for both
- **Verify with:** thread stories
- **Parallel with:** none (after B)

### Chunk E: Call stage + guest stripped view

- **id:** `call-stage-guest`
- **Skill:** workspace + meet
- **Inputs:** A; existing lobby/room panes (no `lib/rtc` edits)
- **Done when:** resizable + fullscreen `MeetCallStage`; guest stripped stories using `MeetLobbyPane` then chat+stage; `ResizablePanelGroup` wrapped with BEM CSS (do not grow Tailwind-in-TSX)
- **Verify with:** Apps/Meet call + guest stories
- **Parallel with:** B, C

### Chunk F: Compose product workspace

- **id:** `compose-workspace`
- **Skill:** workspace + storybook
- **Inputs:** A–E
- **Done when:** `MeetWorkspace` wires sidebar + chat + previews + threads + call; interactive harness; `MeetApp` still mounts `MeetCallWorkspace`; Storybook coverage script green
- **Verify with:** Storybook coverage; MeetApp still `MeetCallWorkspace`
- **Parallel with:** none

### Chunk V: Cross-chunk verify

- **id:** `docs-verify`
- **Skill:** testing + document
- **Done when:** verifier PASS; `workspace-shells.md` + meet skill updated; smells scan; apps done-gate (or `pnpm test:apps-done-gate` fallback)
- **Verify with:** verify-issue on #688; done-gate in this chunk only
- **Parallel with:** none

## Test plan

- [ ] Mock-tier Storybook for every new export; harnesses mutate local state
- [ ] Vitest for pure helpers (partition, URL/unfurl map, mention tokens, chat line builders)
- [ ] Optional `play` on: send message, toggle reaction, open thread, start call → resize → fullscreen, guest lobby → channel
- [ ] No API feature tests, no Playwright in done gate

## Doc updates

- `packages/apps/docs/workspace-shells.md` — Meet row: Split + guest custom/stripped
- `.agents/skills/meet/SKILL.md` — Storybook notes
