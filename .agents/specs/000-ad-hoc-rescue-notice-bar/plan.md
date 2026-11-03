# Rescue notice bar

## Goal

A shared notice bar replaces the rescue header button. Chunk A (this branch) puts three options in Storybook so Wouter can pick one. Chunk B wires the chosen option into Tasks and removes the header button. Later apps reuse the bar when they adopt the rescue dialog.

## Budget

Draws from the Technical debt milestone's rescue work (#1565 follow-up to #1877). Displaces nothing scheduled; Notes, Calendar and Contacts adoption stays where it was.

## Non-goals

- Changing the rescue dialog.
- Parking refused writes in Notes, Calendar or Contacts.
- Moving other toasts into the bar, unless Wouter decides so for the sync notice (Open decisions).

## What exists

- The header button is `RescueEntry`, passed to Tasks as a header action. `path: packages/apps/src/rescue-ui/rescue-dialog.tsx:270`, `path: packages/apps/src/tasks-core/src/tasks-app.tsx:246`
- Its copy is `rescueEntry` in Tasks' labels: "Tasks from N lists need a new list". `path: packages/apps/src/tasks-core/src/tasks-labels.ts:322`
- The button sits in the view header's action row with Show completed and Refresh; at 375px it runs off the right edge and the "(3)" count overlaps the next icon, on main too (seen in the #1877 test run on 5817de2a2). `path: packages/apps/src/tasks-core/src/tasks-workspace.tsx:324`
- `Callout` already renders a severity-tinted notice with icon, title and an action slot. `path: packages/apps/src/callout/src/callout.tsx:34`
- `WorkspaceAppLayout` renders `mainHeader` and then `main-scroll`; anything between them stays in view while the list scrolls. `path: packages/apps/src/workspace-shell/src/workspace-app-layout.tsx:94`
- Stuck sync is a persistent error toast with Retry in Notes, Contacts, Docs and Drive; Tasks has none. `path: packages/apps/src/hooks/use-sync-retry-toast.ts:16`, `path: packages/apps/src/notes-core/src/notes-workspace.tsx:386`
- The rescue dialog opens through `useParkedWrites().openDialog`, which holds a one-tab lock. `path: packages/apps/src/lib/offline/core/use-parked-writes.ts:46`

## Considered

Considered: the existing `Callout` card as-is, a new standalone banner component, and keeping `RescueEntry` but shortening its label. Chosen: `NoticeBar` composes `Callout` (same severity tokens and icon logic) and only reshapes it into a full-width bar, because a second banner component would duplicate `Callout`, and a shorter button label still competes with the header actions on a phone.

## Affected packages

- packages/apps

## Dependencies

1. #1877 merged (the shared rescue dialog and `useContainerRescue`).
2. Chunk A (options in Storybook) → Wouter picks → Chunk B (wire into Tasks).

## Open decisions

- [ ] Chunk B: which option, A (one-line strip), B (strip with a row per list) or C (docked at the bottom, folds to a pill). Wouter decides in Storybook.
- [ ] Chunk B: does the "not synced" notice move into the same bar, or stay a toast? Wouter decides; story "Question · Strip with the sync notice too" shows it.

## Invariants

- Without a notice, the Tasks layout is unchanged: `mainNotice` and `notice` are optional and render nothing when absent. A wrong change shifts the header or list. Proof: `cmd: pnpm --dir packages/apps exec vitest run --project storybook src/tasks-core/stories/tasks-app.stories.tsx`
- The rescue dialog still opens, moves and discards the same way from the new entry point. A wrong change leaves parked tasks with no way to reach them. Proof: `path: packages/apps/src/tasks-core/src/tasks-rescue-dialog.test.tsx`, and `cmd: playwright test -c playwright.matrix.config.mjs tasks-sync-matrix -g "rescued|sharing"` (24 cases).
- After Chunk A, main works without Chunk B: the bar is only used in stories. Proof: `cmd: pnpm --dir packages/apps run typecheck`

## Chunks

### Chunk A: Options in Storybook

- **Skill:** storybook
- **Inputs:** `Callout` — `path: packages/apps/src/callout/src/callout.tsx:34`; layout slot — `path: packages/apps/src/workspace-shell/src/workspace-app-layout.tsx:94`
- **Done when:** `NoticeBar` with variants `strip`, `expandable` and `dock`; `WorkspaceAppLayout.mainNotice` and `TasksWorkspace.notice`; stories "Features/Rescue/Notice bar options" at desktop and 375px, where Review opens the real `TasksRescueDialog`; play tests for Review and the expand toggle.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project storybook src/notice-bar/stories/notice-bar.stories.tsx`; typecheck; lint
- **Parallel with:** none

### Chunk B: Wire the chosen option into Tasks

- **Skill:** apps-ui
- **Inputs:** the option Wouter picks (Open decisions); `RescueEntry` call site — `path: packages/apps/src/tasks-core/src/tasks-app.tsx:246`
- **Done when:** Tasks renders the bar through `notice`; `TasksRescueEntry` and `RescueEntry` are removed; the variants Wouter did not pick are deleted; new `TasksUILabels` entries for the notice copy; `RescueLabels.entry` replaced by the notice labels; the #1877 test script's header-button steps rewritten for the bar and run end to end.
- **Verify with:** apps unit tests; the Tasks sync matrix `-g "rescued|sharing"`; the rewritten test script in a browser at desktop and 375px
- **Parallel with:** none

## Test plan

- [ ] UI: mock-tier Storybook stories for each option, desktop and 375px
- [ ] UI: play tests for Review opening the dialog and for the expand toggle
- [ ] Chunk B: RTL test that the bar appears with parked writes and is gone after the last discard
- [ ] Chunk B: Tasks sync matrix rescue cases stay green

## Doc updates (only if user wants)

- None.
