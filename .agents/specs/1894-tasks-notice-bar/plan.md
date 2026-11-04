# Tasks notice bar

## Goal

A shared notice bar under the main header replaces the rescue header button, and it also carries the "some changes could not sync" notice. Wouter picked the one-line strip (option A) and asked for the sync notice in the same bar (2026-11-03). Tasks is the first app on it; the other apps follow in #1895.

## Budget

Draws from the Pioneer programme's offline work (#1565, after #1877). Displaces nothing scheduled; Notes, Contacts, Docs, Drive and Calendar move to the bar in #1895.

## Non-goals

- Changing the rescue dialog.
- Parking refused writes in Notes, Calendar or Contacts.
- The other apps (#1895).

## What exists

- The rescue header button was `RescueEntry`, passed to Tasks as a header action: [rescue-dialog.tsx:270](https://github.com/WeGotWorkspace/WeGotWorkspace/blob/5817de2a2f8f0385972323f890dc4c911e3fbfb4/packages/apps/src/rescue-ui/rescue-dialog.tsx#L270), [tasks-app.tsx:246](https://github.com/WeGotWorkspace/WeGotWorkspace/blob/5817de2a2f8f0385972323f890dc4c911e3fbfb4/packages/apps/src/tasks-core/src/tasks-app.tsx#L246).
- At 375px that button ran off the right edge and the "(3)" count overlapped the next icon, on main too (seen in the #1877 test run on 5817de2a2), in the header action row: [tasks-workspace.tsx:322](https://github.com/WeGotWorkspace/WeGotWorkspace/blob/5817de2a2f8f0385972323f890dc4c911e3fbfb4/packages/apps/src/tasks-core/src/tasks-workspace.tsx#L322).
- `Callout` already renders a severity-tinted notice with icon, title and an action slot. `path: packages/apps/src/callout/src/callout.tsx:34`
- `WorkspaceAppLayout` renders `mainHeader` and then `main-scroll`; anything between them stays in view while the list scrolls. `path: packages/apps/src/workspace-shell/src/workspace-app-layout.tsx:94`
- Stuck sync is a persistent error toast with Retry in Notes, Contacts, Docs and Drive; Tasks has none. `path: packages/apps/src/hooks/use-sync-retry-toast.ts:16`, `path: packages/apps/src/notes-core/src/notes-workspace.tsx:386`
- Tasks already lists its failed outbox rows, but nothing reads them. `path: packages/apps/src/lib/offline/tasks/tasks-offline-store.ts:153`
- Any Tasks flush error that is not a refusal or an etag mismatch marks the row failed, a network error included. `path: packages/apps/src/lib/offline/tasks/tasks-outbox-flush.ts:195`
- Notes and Contacts polled their failed rows with two copies of the same hook: [use-notes-failed-sync.ts](https://github.com/WeGotWorkspace/WeGotWorkspace/blob/5817de2a2f8f0385972323f890dc4c911e3fbfb4/packages/apps/src/notes-core/src/use-notes-failed-sync.ts), [use-contacts-failed-sync.ts](https://github.com/WeGotWorkspace/WeGotWorkspace/blob/5817de2a2f8f0385972323f890dc4c911e3fbfb4/packages/apps/src/contacts-core/src/use-contacts-failed-sync.ts).
- The rescue dialog opens through `useParkedWrites().openDialog`, which holds a one-tab lock. `path: packages/apps/src/lib/offline/core/use-parked-writes.ts:46`

## Considered

Considered: the existing `Callout` card as-is, a new standalone banner component, and keeping `RescueEntry` with a shorter label. Chosen: `NoticeBar` composes `Callout` (same severity tokens and icon logic) and only reshapes it into a full-width bar, because a second banner component would duplicate `Callout`, and a shorter button label still competes with the header actions on a phone. In Storybook Wouter compared three layouts, a one-line strip (A), a strip with a row per list (B), and a bar docked at the bottom that folds to a pill (C), and picked A.

## Affected packages

- packages/apps

## Dependencies

1. #1877 merged (the shared rescue dialog and `useContainerRescue`).
2. Chunk A → Chunk B and Chunk C (both render through the bar).

## Open decisions

None — Wouter picked option A and the sync notice in the bar (2026-11-03).

## Invariants

- Without a notice, the Tasks layout is unchanged: `mainNotice` and `notice` are optional and the bar renders nothing without notices. A wrong change shifts the header or list. Proof: `path: packages/apps/src/notice-bar/src/notice-bar.test.tsx` assertion `renders nothing when no notice waits`.
- The rescue dialog still opens, moves and discards from the new entry point, also from a second tab. A wrong change leaves parked tasks with no way to reach them. Proof: `cmd: playwright test -c playwright.matrix.config.mjs tasks-sync-matrix -g "rescued|sharing"` (24 cases, `rescueEntry` now finds Review in the bar).
- Notes and Contacts still count their failed rows the same way after the hook is shared. Proof: `path: packages/apps/src/notes-core/src/use-notes-failed-sync.test.tsx`, `path: packages/apps/src/contacts-core/src/use-contacts-failed-sync.test.tsx`.
- Refused task writes do not show as "could not sync": they leave the outbox when parked. A wrong change shows both rows for one refused task. Proof: `path: packages/apps/src/lib/offline/tasks/tasks-parked-writes.test.ts`.

## Chunks

### Chunk A: Notice bar component

- **Skill:** apps-ui
- **Inputs:** `Callout` — `path: packages/apps/src/callout/src/callout.tsx:34`; layout slot — `path: packages/apps/src/workspace-shell/src/workspace-app-layout.tsx:94`
- **Done when:** `NoticeBar` (one line per notice, icon, sentence, one action, no dismiss, `aria-live="polite"` region); `WorkspaceAppLayout.mainNotice`; `TasksWorkspace.notice`; stories "UI/Notice bar" at desktop and 375px.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/notice-bar`; `vitest run --project storybook src/notice-bar`
- **Parallel with:** none

### Chunk B: Rescue notice in Tasks

- **Skill:** apps-ui
- **Inputs:** `useContainerRescue` — `path: packages/apps/src/rescue-ui/use-container-rescue.ts:89`; the bar in Tasks — `path: packages/apps/src/tasks-core/src/tasks-app.tsx:253`
- **Done when:** `rescueNotice()` builds the row from parked writes (`RescueLabels.notice`, `review`, `RescueView.noticeIcon`); `useContainerRescue` returns it; `RescueEntry`, `TasksRescueEntry`, `rescueEntry` and `headerActions` are gone; the matrix finds Review in the bar.
- **Verify with:** `tasks-rescue-dialog.test.tsx`; the Tasks sync matrix `-g "rescued|sharing"`
- **Parallel with:** Chunk C

### Chunk C: Sync notice in Tasks

- **Skill:** apps-ui
- **Inputs:** `listFailedTaskOutbox` — `path: packages/apps/src/lib/offline/tasks/tasks-offline-store.ts:153`
- **Done when:** `useFailedOutboxCount` shared by Notes, Contacts and Tasks; `useTasksSyncNotice` shows "Some changes could not sync. They are saved on this device." with Retry above the rescue row; Retry flushes, rereads the cache, tells other tabs, and the row goes away once the outbox clears.
- **Verify with:** `use-tasks-sync-notice.test.tsx`; the walkthrough with the task request blocked, then unblocked and Retry
- **Parallel with:** Chunk B

## Test plan

- [ ] UI: Storybook "UI/Notice bar": one list, two lists, phone, sync and rescue, sync only; play tests for Review and Retry
- [ ] Vitest: `NoticeBar`, `rescueNotice` copy, `useTasksSyncNotice` (count, Retry success, Retry failure)
- [ ] Tasks sync matrix rescue and sharing cases stay green
- [ ] Browser walkthrough of the test script at desktop and 375px, including a blocked request for the sync notice

## Doc updates (only if user wants)

- None.

## Removed since previous revision

- renamed Chunk A "Options in Storybook" → Chunk A "Notice bar component": options B (expandable) and C (dock) were removed after Wouter picked A.
- Chunk B "Wire the chosen option into Tasks" is split into Chunk B "Rescue notice in Tasks" and Chunk C "Sync notice in Tasks", because the sync notice joined the bar.
- Both Open decisions are made, so the checkboxes are gone.
