Source: #1641 (body-hash: c2ce6e5c)

# One shared list component (#1641 step d)

Technical translation of step (d) of #1641. Only step (d) is in scope. Steps (a) and (b) are done (#1942, #1985), and step (c) waits on the Pioneer programme (#1565, #1636, #2063).

## Goal

Every app list (Notes, Contacts, Tasks, Drive, Docs home, Chat) renders through one component, `WorkspaceList`. Each app binds to it with only two things: its row content and its items in display order. The component owns:

- memoized rows with one shared props comparison;
- windowing (only rows near the viewport are in the DOM), which keeps keyboard navigation, selection, swipe actions, drag and drop, scroll position and the reorder animation working;
- one place to measure: a script that reports long frames per app and scenario.

Users see no change. The only goal is speed with about 1000 items, and fewer copies of the same list code.

## Non-goals

- New keyboard behaviour. The suite keymap (Enter opens, F2 renames, Alt+↑ goes up, roving focus) stays in `useWorkspaceListKeyboardShortcuts`. Apps that miss a key today (Tasks has no Enter or F2) keep missing it in this work; see the plan's Open decisions.
- Changing sort order, grouping or which rows an app shows. Sorting and filtering stay in each app's controller, because keyboard navigation and shift-click ranges read the same ordered ids.
- Saving the list scroll position across reloads. No app does this today (no `scrollTop` is stored anywhere). "Scroll restore" here means: the scroll position survives every re-render, reorder and window change, and the open item stays reachable.
- Making the Chat channel sidebar windowed. It is a short `<ul>` of sidebar rows, not a list pane.
- A new dependency. See the plan's Considered line.

## Affected packages

- `packages/apps` (shared list module, per-app bindings, unit tests, e2e helpers, measurement script)
- `.agents/skills/workspace/feature-blueprint.md` (names the shared list, so new apps bind to it)

## Component API

```tsx
<WorkspaceList
  items={visibleNotes}                 // display order, already sorted and filtered
  getKey={(note) => note.id}           // the entity id; also the row's data-list-item-id
  renderItem={(note) => <NotesListRow note={note} … />}
  estimateSize={() => NOTES_ROW_ESTIMATE_PX}  // px, before the row is measured
  className="notes-list-panel__list"
  // pass-through to WorkspaceSwipeList (unchanged behaviour):
  isTouch activeId selectedIds selectionMode
  onItemClick onItemLongPress onItemDragStart onItemDragEnd
/>
```

- `renderItem` runs only for mounted rows. Work that a row does (excerpt, date label, lookups) runs only for the rows on screen.
- A row component is memoized with the shared comparison: `memo(Row, workspaceListRowPropsEqual)`. The comparison is shallow over the row's own props and ignores the props that `react-swipeable-list`'s `SwipeableList` injects into every child on touch, on every render: `actionDelay`, `destructiveCallbackDelay`, `fullSwipe`, `listType`, `optOutMouseEvents`, `scrollStartThreshold`, `swipeStartThreshold`, `threshold`, `clickedCallback`, `id`, `resetState`. The list is in the `SwipeableList` render in `react-swipeable-list@1.10.0` (`dist/react-swipeable-list.esm.js`, `SwipeableList.render`).
- Each row renders exactly one root element: a `ListItem` button or frame, a swipeable item on touch, or a table row. The window measures rows by their order among the root children (and the children of section elements, below).
- Grouped lists (Contacts' letter sections, Drive's Folders/Files, Chat's days) pass `isHeader(item)`. A header row is kept mounted while any row of its section is mounted, so a sticky header stays visible. A list whose sections are their own elements also passes `renderSection(header, content)`: each run that starts at a mounted header is wrapped in that element (Contacts' `<section aria-labelledby>`), so a sticky header sticks for exactly its own section and the next header pushes it out, as without windowing. A sticky header reports where it is stuck, so its size is measured from its section's top. A grid passes rows of tiles as items: above 80 tiles the Drive grid chunks each section into rows, every row its own grid with the same auto-fill tracks, so the columns line up as in one grid. The column count is the track count of a rendered row, read again when the grid's width changes. Smaller grids stay one grid per section. A tile's focus or drag keeps its row mounted through `keyOfItemId`.

## Windowing

- Generalised from `contacts-core/src/contacts-list-window.ts`: below 80 items every row renders. Above it, rows inside the scrollport plus 480 px of overscan on each side render, and spacer elements stand in for the rest. Rows stay in normal flow (no absolute positioning), so:
  - the FLIP reorder animation (`useListReorderAnimation`) keeps working, fed with the full ordered key list (as Contacts already does);
  - sticky headers keep working;
  - the browser's own scroll anchoring keeps the viewport stable when rows above it change, exactly as without windowing.
- Row sizes are measured, not fixed. Notes, Tasks and Chat rows differ in height (an optional two-line preview, link previews). Each mounted row is measured after render and when it resizes (one `ResizeObserver`). The measured row pitch includes the gap under the row (`--list-item-gap`). Unmeasured rows use the binding's estimate, scaled by how the measured rows compared with their own estimates (so a larger root font size corrects unseen rows too). A binding with exact sizes (Contacts) keeps its rem sizes as the estimate; they turn out exact.
- Where the browser has no scroll anchoring (`CSS.supports("overflow-anchor", "auto")` is false, e.g. Safari), the list corrects `scrollTop` itself when a row above the viewport changes size.
- **Pinned rows** stay mounted even outside the window, each at its true offset (a spacer on each side):
  - the active row (`activeId`): the open item, the keyboard cursor and its `scrollIntoView`/`focus()` in `useListKeyboardNavigation` keep finding it;
  - the row that holds focus, and its neighbours: scrolling away does not drop focus to `<body>`, and a step to the next row in the DOM lands on the next item;
  - the row being dragged: HTML5 `dragend` fires on the source element, so it must not unmount mid-drag;
  - the header of the first mounted section, and the header of every pinned row's section (see above).
- The window reads the scroll container as the nearest scrolling ancestor and the list's own offset inside it, so a quick-add field or padding above the rows does not shift the window.
- When the viewport has no height yet (hidden pane, jsdom), the first 24 rows render, as Contacts does today.
- A container other than the swipe list (Drive's table body and grid) uses the headless `useWorkspaceListRows` hook that `WorkspaceList` wraps: it returns the rows and spacers and an `attachList` ref for the element whose children they are. `renderSpacer` replaces the default spacer `div` (a table passes a spacer row spanning every column, opted out of scroll anchoring like the default one, and shorter by the table's `border-spacing`). `windowAfter` changes the 80-item threshold (the grid windows above 80 tiles, not 80 rows). `animateReorder: false` leaves the FLIP animation off, as Drive had none.
- `revealActive` (Contacts): a newly active row is scrolled into view once. A row within the overscan scrolls the least it needs; a far one lands at the top, as Contacts did. Scrolling the list later never pulls it back. Notes and the other lists leave it off: they already scroll on keyboard moves, and do not move the list when a note opens from a link.

## Keyboard, selection, swipe, drag

None of these move into the component. They already work from ids, not DOM order:

- `useListKeyboardNavigation` steps through `visibleIds` and then scrolls the new active row into view. Pinning the active row makes that row exist when its `requestAnimationFrame` runs.
- Selection highlight comes from `ListSelectionProvider` (a store keyed by id), so it reaches rows as they mount.
- Delegated click, long-press and drag events sit on the list root (`useDelegatedListItemEvents`) and resolve the row from `data-list-item-id`. They work the same for windowed rows.
- Swipe actions stay inside `ListItem`. `WorkspaceList` wraps `WorkspaceSwipeList` unchanged.

Known DOM-wide reads that windowing affects, handled per binding:

- `list-item-focus.ts` `adjacentListItem` walks the DOM. Only the Drive folder picker uses it, and its `DriveListView` windows above 80 items. The window keeps the focused row's neighbours mounted too, so the next row in the DOM is always the next item, even after the list scrolled away from the focused row.
- `refocusListAfterNavigation` looks for the item with `tabindex="0"`. A roving-focus row is the active or first row, and both are mounted (pinned, or at the top).
- e2e helpers that read every row title: `e2e/helpers/tasks-matrix.ts` `shownTitles`, and Drive's `drive-inbound-many-files.spec.ts`. `shownTitles` scrolls a windowed list through and collects the titles, then puts the scroll position back. Every Tasks spec that finds a row by its title (`tasks-sync-matrix`, `tasks-inbound-sync`, `tasks-push`) first calls `revealTask`, which scrolls the row in (or reports that no row has that title), so an account with more than 80 tasks in All Tasks does not break them. Drive's names that must be gone sort to the top, next to an item the spec checks is visible, so they would be mounted if they existed.

## One place to measure

- `packages/apps/scripts/measure-list-frames.mjs` drives a production build in headless Chromium, 1440×900, a fresh context per run. Per scenario it records long animation frames (> 50 ms) from the first interaction until 2.5 s after the last one, plus the DOM node count and the number of mounted rows. It has an optional CPU throttle (`--cpu 4`).
- Each app adds its scenarios there (open, scroll, arrow keys, type or tick). It finds rows by their position on screen, never by DOM index, so the same script measures the list before and after windowing.
- The list root carries `data-workspace-list-rows` (total) and `data-workspace-list-mounted` (rendered), so a test or the script can check windowing without knowing an app's markup.

## Edge cases

- **Browser find-in-page (⌘F)** finds only mounted rows. Contacts already behaves this way. The app's own search is the way to find a row.
- **Swipe destructive actions** collapse the row before the data changes. The resize is measured, and the window follows.
- **Exit animations** (Tasks `tasks-row-exit`) call back from `onAnimationEnd`. An exiting row must stay pinned until its callback runs, or the id stays in `exitingTaskIds`. The Tasks binding passes every exiting id in `pinnedKeys`, next to the active row.
- **Root font size and zoom** change row sizes. Measurement handles both; the estimate is only a start value.
- **Lists of 80 items or fewer** render exactly as today (no spacers, no pinning).
