# Show task due dates on every Calendar view

Derived from [spec.md](./spec.md). Sequential then parallel paint/sidebar.

## Goal

Paint Tasks due dates on every Calendar view from the Tasks store, with per-list sidebar hide and a read-only preview that deep-links to Tasks.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- packages/apps
- `.agents/specs/790-calendar-task-due-overlay/`

## Dependencies

1. Chunk A (mapping + hydrate) before B and C
2. B (sidebar) parallel with C (paint) after A
3. D (preview + `?task=`) after B + C
4. V after D

## Chunks

### Chunk A: Overlay model + hydrate

- **id:** `chunk-a-overlay-model`
- **Skill:** workspace, testing
- **Inputs:** Task schema, Dexie hybrid, CalendarEvent envelope
- **Done when:** mapping + hidden/completed filters tested; hook hydrates and re-reads on visibilitychange / own reconnect flush
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-task-due-overlay.test.ts src/calendar-core/src/use-calendar-task-due-overlay.test.tsx`
- **Parallel with:** none

### Chunk B: Sidebar rows + prefs

- **id:** `chunk-b-sidebar`
- **Skill:** apps-ui, workspace
- **Inputs:** A; CollectionSidebarRow; CalendarViewPrefs
- **Done when:** per-list rows; Calendar-local hide; row click does not change create-target
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-view-prefs.test.tsx src/calendar-core/src/calendar-task-due-sidebar.test.tsx src/calendar-core/src/calendar-workspace.css.test.ts`
- **Parallel with:** chunk-c-paint

### Chunk C: Paint on all views

- **id:** `chunk-c-paint`
- **Skill:** workspace
- **Inputs:** A; Lit surface / timeline / list / year
- **Done when:** overlay events paint on day/week/month/list/year; locked against EventsAPI; year 3-color cap
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/CalendarTimelineView src/lib/calendar-elements/TimeLine src/calendar-core/src/calendar-surface`
- **Parallel with:** chunk-b-sidebar

### Chunk D: Preview + Tasks `?task=`

- **id:** `chunk-d-preview`
- **Skill:** workspace, storybook
- **Inputs:** B + C
- **Done when:** preview popover; Open in Tasks; mock-tier stories
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core/src/tasks-route-search.test.ts src/calendar-core/src/calendar-task-due-popover.test.tsx`
- **Parallel with:** none

### Chunk V: Verify

- **id:** `chunk-v-verify`
- **Skill:** testing, verify-issue, clean-code
- **Inputs:** A–D
- **Done when:** Task #790 AC; apps done-gate
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Vitest mapping, prefs, sidebar, visibilitychange, year cap
- [ ] Mock-tier Storybook two lists
- [ ] `pnpm test:apps-done-gate`
