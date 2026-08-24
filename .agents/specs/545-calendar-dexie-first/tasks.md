# Engineering tasks — Calendar Dexie-first store

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-dexie-first` | builder | plan-feature | `.agents/specs/545-calendar-dexie-first/` | Task #545 + worktree `feat/calendar-dexie-first` | done |
| `port-keepers` | builder | workspace | `packages/apps/src/lib/offline/calendars-*`, scheduling/colors/conflict keepers from quarry | `rg holdEvents offlineOverlay createOfflineCalendarEventsApi packages/apps` absent | done |
| `unify-events-api` | builder | workspace | `calendar-events-api.ts`, `use-calendar-surface.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-events-api.test.ts src/calendar-core/src/use-calendar-surface.test.tsx` | done |
| `paint-from-working-set` | builder | workspace | `use-calendar-surface.ts`, `calendar-surface-events.ts` | surface + `calendar-surface-events` tests | done |
| `jmap-inbound-dexie` | builder | workspace | `JmapEventsAdapter.ts` or `calendars-jmap-inbound.ts`, `use-calendar-api.ts` | inbound-sync Vitest + flush-conflict | done |
| `remove-adapter-push` | builder | workspace | `calendars-hybrid-operations.ts`, `calendar-app.tsx`, `use-calendar-controller.ts`, `offline-platform.md` | Playwright + conflict Vitest | done |
| `verify-invert` | builder | verify-issue | Task #545 AC | focused Vitest (84 passed); `pnpm test:apps-done-gate` and Playwright not run | pending |

## Notes

- Sequential, one HEAD. Do not skip ahead of `port-keepers`.
- Quarry: `/Users/woutervroege/Sites/sabre-installer-calendar-offline` (`fix/calendar-offline-533-539`). Do not merge #543.
- New PR (when asked) repeats `Closes #533 #534 #535 #536 #537 #538 #539`.
