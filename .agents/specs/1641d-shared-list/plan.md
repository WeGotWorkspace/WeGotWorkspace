# One shared list component (#1641 step d)

Derived from [spec.md](./spec.md). One PR per chunk, in order. Each PR lands on its own.

## Goal

Every app list renders through `WorkspaceList`: memoized rows with one shared props comparison, windowing that keeps keyboard, selection, swipe, drag, scroll and the reorder animation working, and one measurement script. No user-visible change.

## Budget

Draws from the Technical debt milestone (#14), step (d) of #1641. It displaces nothing in the Pioneer programme. It touches list panels only, not the `*-workspace.tsx` files of step (c), so it does not collide with #1565, #1636 or #2063.

## Non-goals

- New keys, new sort orders, a persisted scroll position, a new dependency. See [spec.md](./spec.md#non-goals).

## What exists

- Contacts windows its list with fixed rem row sizes, above 80 rows, with 480 px of overscan. `path: packages/apps/src/contacts-core/src/contacts-list-window.ts:13`
- The Contacts window keeps the letter header of the first mounted section, and scrolls a new active row into view by offset when it is outside the window. `path: packages/apps/src/contacts-core/src/contacts-list-panel.tsx:271`
- Notes rows are memoized with a per-app key list that skips the props `SwipeableList` injects (#1721). `path: packages/apps/src/notes-core/src/notes-list-row.tsx:63`
- Tasks has its own copy of that comparison. `path: packages/apps/src/tasks-core/src/tasks-list-row.tsx:62`
- `SwipeableList` clones every child with `actionDelay`, `destructiveCallbackDelay`, `fullSwipe`, `listType`, `optOutMouseEvents`, `scrollStartThreshold`, `swipeStartThreshold`, `threshold`, `clickedCallback`, `id` and `resetState`. `path: node_modules/.pnpm/react-swipeable-list@1.10.0/node_modules/react-swipeable-list/dist/react-swipeable-list.esm.js:258`
- Notes, Contacts, Tasks and the Calendar list view all render through `WorkspaceSwipeList`. `path: packages/apps/src/calendar-core/src/calendar-event-list.tsx:7`
- Keyboard navigation steps through ids and then looks the row up in the whole document inside a `requestAnimationFrame`, to scroll it into view and move focus. An unmounted row is skipped silently. `path: packages/apps/src/hooks/use-list-keyboard-navigation.ts:41`
- `ListItem` rows already use `content-visibility: auto`, which skips painting off-screen rows but keeps their DOM and React work. `path: packages/apps/src/list-item/src/list-item.css:26`
- Drive and Docs home render `DriveListView` (a `<table role="grid">` with roving `tabindex`) and `DriveGridView` (Folders and Files sections of auto-fill tiles). Nothing there is memoized. `path: packages/apps/src/drive-core/src/drive-browser.tsx:101`
- Drive's roving focus marks rows with `data-list-item-focus`. `path: packages/apps/src/drive-core/src/drive-browser.tsx:632`
- The Chat message list is a bottom-anchored `role="log"` that sticks to the end through a `ResizeObserver`. `path: packages/apps/src/chat-ui/src/chat-message-list.tsx:126`
- Every chat message mounts its own read-only text editor. `path: packages/apps/src/chat-ui/src/chat-message.tsx:57`
- Tasks wires only arrow keys, delete, undo and search from the shared keymap; there is no Enter or F2. `path: packages/apps/src/tasks-core/src/use-tasks-controller.tsx:115`
- An e2e helper reads every Tasks row title from the DOM, which windowing would cut short. `path: packages/apps/e2e/helpers/tasks-matrix.ts:396`
- No measurement script or LoAF observer existed in the repo before this work.
  ```
  $ grep -rn "long-animation-frame\|PerformanceObserver" packages/apps/{e2e,src,scripts} tools   # (no output on main d2879da3a)
  ```
- Notes on `main` (d2879da3a) at 955 notes, production build, measured with `scripts/measure-list-frames.mjs`: 12,307 DOM nodes and 955 mounted rows. A cold open has 3 long frames (worst 222–229 ms, total 358–368 ms).
  ```
  notes open run 1 (cpu 1x): 3 / 229 / 368 ms (long frames / worst / total), 12307 nodes, 955 rows mounted
  ```

## Considered

Considered: the existing Contacts windowing (`contacts-list-window.ts`), `@tanstack/react-virtual`, and CSS `content-visibility` alone.
- **Chosen: generalise the Contacts windowing, with measured row sizes.**
  - Its math, its 80-row threshold, its overscan and its header rule are already tested and shipped.
  - Measuring is added because Notes, Tasks and Chat rows differ in height. Fixing their heights in CSS (the Contacts approach) would be a visible change.
  - Rows stay in normal flow with spacers, so FLIP transforms, sticky headers, `SwipeableList`'s direct-children contract and native scroll anchoring all keep working.
- **Rejected: `@tanstack/react-virtual`.**
  - Its measuring reads an index attribute on each row's root element. On touch that root is `react-swipeable-list`'s own `div`, which we can't attribute without wrapping, and wrapping changes the `SwipeableList` child contract.
  - Its examples position rows absolutely, which fights the FLIP transforms and sticky headers.
  - It also adds a dependency for about 150 lines we already own.
- **Rejected: `content-visibility` alone.**
  - It is already on (`list-item.css:26`), yet Notes still has 12,307 nodes and a 229 ms frame on open.
  - It skips paint, not DOM or React work.
- **Considered: sorting inside the component.**
  - Rejected, because keyboard navigation and shift-click ranges read the controller's `visibleIds`. Two sources of order would drift.
  - The sort key stays in each app's controller, and the component takes items in display order.

## Affected packages

- packages/apps
- .agents/skills/workspace

## Dependencies

1. Chunk A (shared module + Notes) first: it proves the API with the binding that has a regression test (#1721).
2. Chunk B (Contacts) after A: it removes the old windowing, so there is one implementation.
3. Chunks C (Tasks), D (Drive), E (Docs home) after B, in that order. E reuses D's views.
4. Chunk F (Chat messages) last: bottom-anchored windowing is a variant of A's window.

## Open decisions

None for chunk A. These were found while writing the spec. Each is a behaviour difference between apps, so it goes to the overview session (and Wouter) before the chunk that would change it:

- [ ] (chunk C) Tasks rows get Enter (open) and F2 (rename) from the suite keymap. Today Tasks has neither. Chunk C keeps today's keys unless this is decided.
- [ ] (chunk C) Notes, Tasks and Contacts rows become one roving Tab stop, like Drive (the keymap decision says "roving focus"). Today every row is a Tab stop. Windowing already limits Tab to mounted rows. Chunks A–C keep the plain buttons unless this is decided.
- [ ] (chunk D) Drive's grid shows Folders before Files, but ↑/↓ and shift-click ranges follow the sort order across both. Under the Modified or Size sort the keys jump between sections. This is a bug on `main`, filed as #2090. Chunk D windows each section without changing the order.

## Invariants

- One changed note re-renders only its own row, also when it moves to the top of a list of 1000. A wrong comparison renders every mounted row again. Proof: `path: packages/apps/src/notes-core/src/notes-list-render-count.test.tsx` assertion `renders one row when the edited note moves to the top`
- A list of 80 items or fewer renders every row with no spacers. A wrong threshold changes small lists. Proof: `path: packages/apps/src/workspace-list/src/workspace-list-window.test.ts` assertion `renders a short list in full`
- The active, focused and dragged rows stay mounted outside the window. Without that, keyboard navigation loses focus and a drag never ends. Proof: `path: packages/apps/src/workspace-list/src/workspace-list.test.tsx` assertion `keeps the active row mounted far outside the window`
- Rows that `SwipeableList` clones with new `resetState` and `id` props on every render do not re-render. Proof: `path: packages/apps/src/workspace-list/src/workspace-list-row-props.test.ts` assertion `ignores the props SwipeableList injects`
- After chunk A, Notes behaves as on `main` (keyboard, shift-range, swipe on touch, drag to a notebook, reorder after typing, reload with an open note). Proof: `path: packages/apps/e2e/notes-list-windowed.spec.ts` assertion `arrow keys walk past the window and keep focus`
- After chunk B, `contacts-list-window.ts` is gone and Contacts keeps its letter headers and scroll-to-open-contact. Proof: `path: packages/apps/src/contacts-core/src/contacts-list-panel.test.tsx` assertion `scrolls a far contact into view when it opens`

## Chunks

### Chunk A: shared list + Notes binding
- **Skill:** workspace
- **Inputs:** Notes row memo and render-count test from #1721 — `path: packages/apps/src/notes-core/src/notes-list-row.tsx:63`. Contacts window math — `path: packages/apps/src/contacts-core/src/contacts-list-window.ts:62`
- **Done when:**
  - `packages/apps/src/workspace-list/src/` has the window math, the hook, `WorkspaceList` and `workspaceListRowPropsEqual`, each with tests.
  - `NotesListPanel` renders through `WorkspaceList`, and `notes-list-row.tsx` uses the shared comparison.
  - `scripts/measure-list-frames.mjs` has the Notes scenarios, and the PR shows before and after numbers at about 1000 notes.
  - The live e2e `notes-list-windowed.spec.ts` passes.
  - Own browser e2e (cold context, keyboard, touch swipe, drag, reload) with screenshots.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/workspace-list src/notes-core`, the live spec, the measurement script
- **Parallel with:** none

### Chunk B: Contacts onto the shared window
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/contacts-core/src/contacts-list-panel.tsx:221`
- **Done when:** Contacts renders through `WorkspaceList`, with letter headers as header rows, its `<section>` per letter through `renderSection`, and its rem sizes as the estimate. It scrolls a newly opened contact into view (Contacts' behaviour today, through a `revealActive` option). `contacts-list-window.ts` and its test are deleted, and the measurement shows 0 long frames, as on `main`.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/contacts-core`, `e2e/contacts-first-open-count.spec.ts`, the measurement script
- **Parallel with:** none

### Chunk C: Tasks
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/tasks-core/src/tasks-list-row.tsx:62`, `path: packages/apps/e2e/helpers/tasks-matrix.ts:396`
- **Done when:**
  - Tasks renders through `WorkspaceList` with the shared comparison.
  - An exiting row stays pinned until its exit animation ends.
  - `shownTitles` reads the list without depending on every row being mounted.
  - The measurement covers open, tick and type-title at 1000 tasks in one list.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core`, the tasks sync matrix, the measurement script
- **Parallel with:** none

### Chunk D: Drive list and grid
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/drive-core/src/drive-browser.tsx:419`
- **Done when:**
  - The list view windows table rows with spacer rows, keeping the hairlines and the roving `tabindex` row mounted. `DriveListView` binds through the headless `useWorkspaceListRows`; the folder picker and Docs home get it through their reuse.
  - The grid windows rows of tiles per section above 80 tiles; the column count is a rendered row's track count, read again on resize.
  - Previews still load only for tiles in view, and the preview observer lets go of tiles that unmount.
  - Items sit at the same pixel positions as on `main` at any scroll depth, in both views.
  - The measurement covers open, scroll, keys, rename and search on a folder of 1000 files and 20 folders, in both views.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/drive-core`, `e2e/drive-inbound-many-files.spec.ts`, `e2e/drive-list-windowed.spec.ts`, the measurement script
- **Parallel with:** none

### Chunk E: Docs home
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/docs-core/src/docs-home-pane.tsx:411`
- **Done when:** Docs home gets chunk D's windowed views through its existing reuse, and previews use the tiles-in-view hook as Drive does. `docs-home-browse.spec.ts` passes with 1000 docs.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core`, `e2e/docs-home-browse.spec.ts`, the measurement script
- **Parallel with:** none

### Chunk F: Chat message list
- **Skill:** workspace
- **Inputs:** `path: packages/apps/src/chat-ui/src/chat-message-list.tsx:126`
- **Done when:**
  - Messages are memoized with the shared comparison.
  - The list windows from the bottom: it sticks to the end, keeps the day headers, and keeps the "New messages" chip.
  - Only mounted messages create a text editor.
  - The measurement covers open channel and scroll-up at 1000 messages.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/chat-ui`, `e2e/meet-chat-push.spec.ts`, the measurement script
- **Parallel with:** none

## Test plan

- [ ] Unit (node): window math, including the threshold, overscan, segments with pinned rows, header pinning and measured sizes.
- [ ] Unit (jsdom): `WorkspaceList` mounts only a window, keeps pinned rows, renders one row per change, and does not re-render rows on `SwipeableList` clones.
- [ ] Live e2e per chunk: keyboard past the window, shift-range across the window, swipe on a touch viewport, drag to the sidebar, reload with an open item, reorder after an edit.
- [ ] Measurement per chunk, before and after, at about 1000 items, normal CPU and 4× throttle.

## Doc updates (only if user wants)

- `.agents/skills/workspace/feature-blueprint.md`: new list panels bind to `WorkspaceList` (chunk A).
