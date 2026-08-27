Source: #637 (body-hash: 91670a9b)
Goal: #523

# Calendar event search

Technical translation of Task #637. Product context: Goal #523 (find events by searching in Calendar).

## Goal

Add Calendar ViewHeader search that filters the Dexie/bootstrap corpus (title, location, master description) as a case-insensitive exact substring of the trimmed query, then replaces the calendar surface with a locked upcoming/past results list until the query is cleared. Open a result by restoring the previous view/date/presentation, jumping to that occurrence’s date, and opening the event popover.

## Non-goals

- Slash/qualifier language (`is:` / `in:` / `after:`)
- Unified cross-app search
- Saved searches
- JMAP/unified search beyond `calendarBootstrapWindow()`
- Attendee matching
- Tokenized matching
- Occurrence description overrides (master `description` only)
- Web Worker / off-main-thread search
- Creating or editing events
- Marking Goal #523 Fulfilled (product judgment after success signals)

## Affected packages

- `packages/apps` — `calendar-core` matcher/controller/workspace, shared `view-header` flush-on-empty, labels, CSS, mock-tier stories

## Technical constraints

- Match input is `occurrencesInRange(data.events, calendarBootstrapWindow(), { visibleCalendarIds })` plus a description lookup from wire masters. Do **not** iterate Lit/grid rendered events or `surfaceEventsForView`.
- Query language is plain free-text only. Trim, then case-insensitive exact substring on title, location, and master description. No tokenized / AND matching.
- Sidebar visibility is a scope filter, not a searchable field.
- Offline by default: same Dexie working set (12 months back + 24 months ahead, snapped to month start). No extra download; no JMAP title query; no online-only hide (unlike Drive `searchEnabled={online}`).
- Results list is dedicated (upcoming + past, **no result cap**). Render with `calendar-list-view` `use-event-set` (same list SST). Do not use the period agenda window (max 366 days).
- Search activates only when the trimmed query is **≥ 3 characters**. 1–2 chars stay in browse (grid stays). Debounce remains 180ms; clear still flushes immediately. Calendar-only floor — other ViewHeader apps stay 1-character.
- Controller: `setSearchQuery` is a plain setter. Snapshot/restore `{ view, presentation, anchor }` on first active (≥ 3) debounced query. `searchActive`. Lazy expand: always call `useMemo`; factory returns a stable empty list when `!searchActive`. Do not write `window.location` / router search from the hook — App `useCalendarRouteSync` owns the URL.
- Chrome: reuse suite `ViewHeader` + `CollectionSearchInput` full-width under the title/actions row (`layout="responsive"`). Wire `useWorkspaceListKeyboardShortcuts` for ⌘/Ctrl+K and `/`.
- Shared `ViewHeader` change: flush `onSearchInput` immediately only on **non-empty → empty**; keep 180ms for typing; no `onSearchInput('')` on mount; pending timer cancelled on clear. Suite-wide for Mail, Notes, Drive, Docs, Contacts (Calendar is the sixth).
- CSS: BEM + `@apply` under `.calendar-workspace`. No long Tailwind in TSX.
- URL: persist the trimmed query as `?q=` only when length ≥ 3. Empty / whitespace / 1–2 char `q` is omitted. Query-only updates `replace`; opening a result still pushes the browse path without `q`.
- Scope chrome: results list shows a calm header for the searched window (union of `calendarBootstrapWindow()` and the on-screen period), e.g. `Visible calendars · Aug 2025 – Aug 2028`. Not a truncation caption; not a cream footer slab. Empty / no-hit still shows this scope.
- `fixes` the Task (#637), not Goal #523.

## Product overrides vs original Task/plan

Owner request during implementation (issue body-hash unchanged):

- **No result cap.** Original Task asked for 100+100 plus truncation captions. Caps and `truncatedUpcoming` / `truncatedPast` are removed.
- **Min query length 3** (trimmed) before search replaces the grid. Balances unconstrained results.
- **Scope label yes, truncation captions no.** Show `Visible calendars · {start} – {end}` on the results list (header). Do not show “Showing the next 100” / “Showing the most recent 100”. Do not show a raw “Downloaded …” caption. Story `SearchNoMatch` still locks absence of `Downloaded `.

## Edge cases

- Empty / whitespace-only / 1–2 character query is not search-active; restore browse state without opening an event
- `"  standup  "` matches the same as `"standup"`
- `call client` does **not** match title `Client call`
- Hit outside the visible week but inside the bootstrap window must appear
- Recurring series: one row per in-window occurrence; no per-section cap
- In-progress events (`end > now`) count as upcoming
- Empty upcoming + some past is valid (scroll to Past)
- Both empty → `CollectionState` no-match
- Hidden calendars are excluded
- Master description match scores every instance; occurrence-only description override is missed
- Type then clear within 180ms: pending “verg” timer must not resurrect
- Mount with empty `searchValue` must not call `onSearchInput('')`
- Background `/changes` while browsing must not expand occurrences
- Empty flush is independent of `searchDebounceMs` (optional ViewHeader test)
- Reload / paste of `/calendar/:view/:date?q=standup` restores the query and results; `?q=` / whitespace-only / 1–2 char `q` is browse
