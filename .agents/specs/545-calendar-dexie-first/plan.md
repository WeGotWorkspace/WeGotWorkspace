# Calendar Dexie-first store

Derived from [spec.md](./spec.md). Sequential chunks, one HEAD — do not parallelize file ownership.

## Goal

Unify Calendar on one Dexie-first working set. #543 is a quarry (port keepers), not the base. The adapter becomes inbound-only JMAP sync.

## Non-goals

- See [spec.md](./spec.md)
- Do not implement #540 as a product ticket

## Affected packages

- packages/apps
- packages/apps/docs

## Dependencies

1. Chunk 0 (Task + worktree + spec) — done in delivery
2. Chunk 0b keepers before A (hybrid/cache must write so A can attach)
3. A (one EventsAPI) before B (paint) — otherwise two writers
4. B before C (inbound → Dexie)
5. C before D (remove adapter-push)
6. V last

## Chunks

### Chunk 0: Task, worktree, spec

- **id:** `calendar-dexie-first`
- **Skill:** plan-feature, issue-filing, git-workflow
- **Inputs:** Goal #385; Task #545; quarry PR #543
- **Done when:** `feat/calendar-dexie-first` exists from `origin/main`; spec `Source: #545`; Task + PR link #533–#539 as closing issues; #543 is not the landing PR
- **Verify with:** Task URL; worktree path; `gh pr view 543 --json state`
- **Parallel with:** none

### Chunk 0b: Port keepers (no surface-split)

- **id:** `port-keepers`
- **Skill:** workspace
- **Inputs:** Meenemen table; quarry `/Users/woutervroege/Sites/sabre-installer-calendar-offline`
- **Done when:** Dexie 50–52, hybrid/outbox/conflict/scheduling/colors are on the feat branch; `rg holdEvents offlineOverlay createOfflineCalendarEventsApi` is absent until A introduces the single store
- **Verify with:** `rg holdEvents offlineOverlay createOfflineCalendarEventsApi packages/apps`
- **Parallel with:** none

### Chunk A: Always the same EventsAPI

- **id:** `unify-events-api`
- **Skill:** workspace
- **Inputs:** Ported hybrid ops; `createCalendarEventsApi` (not the #543 offline-fork as a second context)
- **Done when:** Vitest: create/move/delete via context works with `online: true` and `online: false` against the same API; adapter is never `contextValue`. Do **not** still let the adapter paint (that is B).
- **Verify with:** `offline-calendar-events-api.test.ts` (or renamed), expanded `use-calendar-surface.test.tsx`
- **Parallel with:** none

### Chunk B: Grid paints only working set + Dexie

- **id:** `paint-from-working-set`
- **Skill:** workspace
- **Inputs:** Chunk A EventsAPI
- **Done when:** reconnect-test: event-card count never becomes 0; offline delete stays gone; no snap-back to stale cache after move. `reconnectSyncing` is not an adapter-mount gate.
- **Verify with:** surface + `calendar-surface-events` tests; Playwright `calendar-offline-week-event.spec.ts` reconnect-assert
- **Parallel with:** none

### Chunk C: JMAP inbound → Dexie

- **id:** `jmap-inbound-dexie`
- **Skill:** workspace
- **Inputs:** Chunk B paint path
- **Done when:** remote create/update appears via Dexie/bootstrap, not `adapter.getEvents()`; pending local move is not reverted by ingest; fake timers / network-count: after two poll intervals exactly one inbound `/changes` series; inbound clash still calls `reportCalendarsSyncConflicts`
- **Verify with:** inbound-sync Vitest (including `vi.useFakeTimers` call-count) + flush-conflict test
- **Parallel with:** none

### Chunk D: Adapter-push out of the surface + cleanup

- **id:** `remove-adapter-push`
- **Skill:** workspace, document, testing
- **Inputs:** Chunk C inbound driver
- **Done when:** `rg JmapEventsAdapter` in `calendar-core` is inbound-wiring only; e2e green; `offline-platform.md` names Calendar; conflict-dialog still opens on inbound/flush clash
- **Verify with:** Playwright `calendar-offline-week-event.spec.ts` + conflict Vitest + `pnpm test:apps-done-gate` (before push)
- **Parallel with:** none

### Chunk V: Cross-check

- **id:** `verify-invert`
- **Skill:** verify-issue, code-review
- **Inputs:** Combined diff vs `origin/main`
- **Done when:** no second write-path; no adapter-as-store in stories; Task AC mapped; verifier PASS / PASS_WITH_NITS + done-checklist
- **Verify with:** [verify-issue](../../skills/verify-issue/SKILL.md) Task mode; [done-checklist](../../skills/developer/done-checklist.md)
- **Parallel with:** none

## Test plan

- [ ] Vitest: EventsAPI persist, merge (pending slot wins), inbound skip-pending, one poll-loop (call-count), conflict-channel after inbound/flush, surface no adapter-paint, reconnect hold = working set
- [ ] Playwright (worktree Vite **5197**):

```bash
cd packages/apps
WGW_APPS_E2E_NO_SERVER=1 WGW_APPS_E2E_BASE_URL=http://127.0.0.1:5197 \
  pnpm exec playwright test --config playwright.live.config.mjs \
  e2e/calendar-offline-week-event.spec.ts
```

- [ ] Storybook mock-tier: interactive grid via the same EventsAPI + mock operations
- [ ] `pnpm test:apps-done-gate` before push

## Doc updates

- Calendar row in `packages/apps/docs/offline-platform.md`
