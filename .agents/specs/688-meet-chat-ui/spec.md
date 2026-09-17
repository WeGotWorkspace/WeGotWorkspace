Source: #688 (body-hash: 70ee9f78)
Goal: #686

# Meet chat workspace frontend (Storybook)

Technical translation of Task #688. Product context: Goal #686 (chat in named Meet channels and start a call from the same place). Delivery parent: Epic #687.

## Goal

Turn Meet’s Storybook surface into the same **split** workspace other apps use: ACL’d named channels (and meeting rooms), persistent chat as the main column, and an optional resizable/fullscreen call stage that reuses today’s lobby/room panes. Live `/meet` stays on the current custom lobby/room (`MeetCallWorkspace`) so the WebRTC refactor is not blocked. The new `MeetWorkspace` is an exported, mock-wired product surface ready to mount later.

## Non-goals

- API, OpenAPI, Sabre collections, message persistence, live unfurl fetchers
- `lib/rtc` / signaling / SDP / poll cadence
- File attachments, 1:1 DMs, custom emoji, searchable full emoji picker
- Switching the live `MeetApp` route
- Refactoring Docs comments onto the new chat primitives
- Marking Goal #686 Fulfilled from this Task alone

## Affected packages

- `packages/apps` — meet-core split shell, chat-ui primitives, mock bootstrap / stub operations, Storybook
- `packages/apps/docs` — Meet row in `workspace-shells.md` (verify chunk)
- `.agents/skills/meet` — Storybook notes (verify chunk)

## Technical constraints

- **Frontend only.** No OpenAPI, Laravel, or `lib/rtc` edits.
- **Rename, don’t replace the live shell.** Today’s `MeetWorkspace` becomes `MeetCallWorkspace`. `MeetApp` and mock `/meet` routes keep mounting `MeetCallWorkspace`.
- **Split shell** uses `WorkspaceAppLayout` + `AppSidebar` + `ViewHeader`. Chat is full-bleed like Docs (`--workspace-main-content-max-width: none`, zeroed main padding/scroll flex). Call stage is **not** the docs comments `panel`.
- **Channel model** mirrors Notes/Tasks collections plus `kind: "channel" | "meeting"`. Sidebar: Channels (owned channel) → Shared with me → Meetings (owned meeting). `CollectionSidebarRow` **without** visibility checkboxes.
- **Create/edit** clones `TaskProjectDialog` (`OwnerScopeField` + `CollectionShareSection`). Meeting kind adds guest-link copy via `MeetShareButton` / `buildMeetGuestCallLink`.
- **Chat primitives** live in `packages/apps/src/chat-ui/` with `Shared/Chat/*` stories (product-agnostic). First consumer is Meet. Copy Docs 6-emoji reactions; do not refactor docs-collab.
- **Previews** are injected by mock operations from a static unfurl map — no network. URL detection extends `renderMeetChatBody`.
- **Threads vs call rail:** idle → split `panel`; call active → `SideDrawer` over chat; guest → no channel sidebar (`hideSidebarToggle`).
- **Operations DI.** Panes stay presentational. No `@/lib/api/wgw` in panes.
- **BEM + `@apply` in CSS**; no long Tailwind in TSX. Mock-tier Storybook for every new export.

## Edge cases

- Shared meeting rooms appear under **Shared with me**, not Meetings (`partitionOwnedAndShared` then split owned by `kind`).
- Group member who is not a sharee stays under Channels / Meetings (owned via group), not Shared with me.
- Guest stripped view is one room (chat + call), never a channel list.
- `MeetChatPane` stays on `MeetCallWorkspace` until the live route flips.
- Start / Join call in stories is a stub (`callActive` + mock peers); do not call `useMeetRtc` from chat primitives.
