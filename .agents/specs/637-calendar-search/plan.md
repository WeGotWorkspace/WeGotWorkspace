# Calendar event search

Derived from [spec.md](./spec.md). Sequential chunk layout from the locked Cursor plan.

## Goal

Implement Task #637: Calendar ViewHeader search over the bootstrap cache, locked results list, snapshot/restore, suite flush-on-empty. Product context: Goal #523.

## Non-goals

- Qualifier language, unified/saved search, JMAP beyond cache, attendees, tokenized match, occurrence description overrides, Worker, create/edit
- Auto-closing Goal #523

## Affected packages

- packages/apps

## Dependencies

1. **setup (0)** first — Task filed, worktree + `feat/calendar-search` from `origin/main`, spec/plan/tasks with body-hash.
2. **matcher (A)** before **controller (B)**.
3. **controller (B)** before **chrome (C)**.
4. **verify (V)** after A–C.

## Chunks

### Chunk 0: File Task + spec

- **id:** `setup`
- **Skill:** plan-feature, issue-filing, git-workflow
- **Inputs:** Goal #523, locked Cursor plan
- **Done when:** Task #637 filed under #523 (`area:calendar`, milestone `v0.9`, not on Product Project) with AC + non-goals + Suite impact; worktree `feat/calendar-search`; `spec.md` / `plan.md` / `tasks.md` with `Source: #637 (body-hash: 91670a9b)`
- **Verify with:** `gh issue view 637`; parent is #523; specs exist in this worktree
- **Parallel with:** none

### Chunk A: Pure matcher + rank

- **id:** `matcher`
- **Skill:** workspace, testing
- **Inputs:** `occurrencesInRange`, `calendarBootstrapWindow`
- **Done when:** `calendar-search.ts` expands via `occurrencesInRange(..., calendarBootstrapWindow(), { visibleCalendarIds })`, then trim + exact substring on title/location/master description; split/sort with **no result cap**; 1–2 char queries are empty. Vitest covers empty/whitespace/short query, trim, case, exact-substring vs token order, field isolation, bootstrap-window expansion, recurrence multiples, upcoming-vs-past split/sort.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-search.test.ts`
- **Parallel with:** none

### Chunk B: Controller search mode

- **id:** `controller`
- **Skill:** workspace
- **Inputs:** `use-calendar-controller.ts`, Chunk A matcher
- **Done when:** `searchQuery` / `setSearchQuery` plain setter; snapshot + restore; `searchActive`; lazy `useMemo` (stable empty when `!searchActive`); `openSearchResult` restores then opens preview. RTL covers activate, lock, restore-on-clear, restore-on-open, no expansion while browsing (including Dexie update during browse).
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-controller.test.tsx`
- **Parallel with:** none

### Chunk C: Workspace chrome + results list + stories

- **id:** `workspace-ui`
- **Skill:** workspace, apps-ui, storybook, accessibility
- **Inputs:** `calendar-workspace.tsx`, `calendar-labels.ts`, `calendar-workspace.css`, `calendar-app.stories.tsx`, `view-header.tsx`
- **Done when:** ViewHeader flush-on-empty (non-empty → empty only); 180ms typing; no mount empty callback; pending timer cancelled; empty flush independent of `searchDebounceMs`. Calendar-only `searchMinLength=3`. Calendar search chrome, keyboard shortcuts, locked period chrome, dedicated results list, CollectionState no-match, scope label on results, no truncation captions, BEM+`@apply`. Stories + fake-timer play. Mail/Notes/Drive/Docs/Contacts search tests still green. Header-layout CSS tests kept.
- **Verify with:** ViewHeader + consumer search Vitest, story `play`, then apps done-gate in Chunk V
- **Parallel with:** none

### Chunk V: Verify

- **id:** `verify`
- **Skill:** verify-issue, code-review, testing
- **Inputs:** merged A–C; Task #637 AC; Goal #523 success signals
- **Done when:** Task AC all `PASS`; Goal success signals observable on the Task; spec body-hash `SYNC OK`; done-checklist green. Do not `git commit` or open a PR.
- **Verify with:** verify-issue + `pnpm test:apps-done-gate` (wgw-verify when available)
- **Parallel with:** none

## Test plan

- [ ] Vitest matcher (`calendar-search.test.ts`)
- [ ] RTL controller lock/restore/no-expand
- [ ] ViewHeader fake-timer: typing debounce, flush-on-empty, verg race, no mount empty, flush independent of `searchDebounceMs`
- [ ] Existing Mail/Notes/Drive/Docs/Contacts search tests
- [ ] Mock-tier Storybook play (idle, matches, no-match, result-open, typing burst, X restore; truncated caption lock is unit/CSS)
- [ ] `pnpm test:apps-done-gate`

## Doc updates (only if user wants)

- None unless asked
