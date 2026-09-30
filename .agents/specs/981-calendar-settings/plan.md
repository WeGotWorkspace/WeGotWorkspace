# Calendar settings pane

Derived from [spec.md](./spec.md). Sequential chunks. Source Task #981.

## Goal

Device-local Calendar display prefs (timezone, week start, visible hours, default calendar) in Settings and the in-app dialog, wired into the grid.

## Budget

Parent Goal #617. Lands on the #973 settings-registry PR. Displaces no Adopted v0.9 packing.

## Non-goals

See [spec.md](./spec.md).

## What exists

- Registry + Mail Apps panel + Calendar footer `appId`. `path: packages/apps/src/settings-core/src/register-builtin-settings.tsx:46`
- Device-local view prefs pattern. `path: packages/apps/src/calendar-core/src/calendar-view-prefs.ts:1`
- Lit surface already has `timezone` and `weekStart`. `path: packages/apps/src/lib/calendar-elements/wgw/wgw-calendar-surface.ts:44`
- Timeline already has `visibleHours` / `visibleHoursStart`. `path: packages/apps/src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.ts:197`
- View-group day/week timeline forwards `visibleHours` and `visibleHoursStart`. `path: packages/apps/src/lib/calendar-elements/CalendarViewGroup/CalendarViewGroup.ts:345`
- Controller locale is `resolveLocale(undefined)` once. `path: packages/apps/src/calendar-core/src/use-calendar-controller.ts:190`

## Considered

Considered: OpenAPI user prefs — rejected; #627 already set device-local for Calendar UI prefs and #981 AC forbids a new API.
Considered: settings-core importing calendar-core for the timezone list — rejected; registry constraint.
Considered: working-hours shading on the grid — rejected; #527.

## Affected packages

- packages/apps

## Dependencies

1. Chunk 0 specs exist (this folder).
2. Prefs module (A) before pane (B) and grid wiring (C).
3. Pane registration (B) can land before grid wiring (C); nav appears as soon as the slice is reachable.
4. After chunk B, Mail still works without C.

## Open decisions

None — every choice for this work is made.

## Invariants

- Calendar remains under Apps. Mail stays off nav; `/settings/mail` still explains unshipped mailbox login. Proof: `path: packages/apps/src/settings-core/src/settings-registry.test.ts` assertion `keeps Calendar, Tasks, Contacts, and Notes under Apps`
- After chunk A, existing view-prefs `localStorage` key is untouched. Proof: `path: packages/apps/src/calendar-core/src/calendar-view-prefs.test.tsx`
- After chunk B, `/settings/mail` still explains unshipped mailbox login. Proof: `path: packages/apps/src/settings-core/src/settings-app-route-click.test.tsx` assertion `explains a direct mailbox-login link`
- After chunk C, CalendarSurface tests that omit display props keep the Lit Monday `weekStart` default. Proof: `path: packages/apps/src/calendar-core/src/calendar-surface-view-echo.test.tsx`

## Chunks

### Chunk 0: Spec from Task #981

- **id:** `file-spec`
- **Skill:** plan-feature
- **Inputs:** Task #981 body-hash `e57dee26`
- **Done when:** spec/plan/tasks exist with `Source: #981 (body-hash: e57dee26)` and `Goal: #617`
- **Verify with:** `gh issue view 981 --json body --jq .body | shasum -a 256`
- **Parallel with:** none

### Chunk A: Display prefs module

- **id:** `display-prefs`
- **Skill:** apps-ui
- **Inputs:** view-prefs pattern; curated event timezone list
- **Done when:** `lib/calendar-display-prefs.ts` reads/writes/parses; shared timezone list lives in `lib/`; resolve week start; unit tests
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-display-prefs.test.tsx src/lib/calendar-time-zones.test.ts`
- **Parallel with:** none

### Chunk B: Settings pane + registry

- **id:** `calendar-pane`
- **Skill:** workspace, storybook
- **Inputs:** Chunk A
- **Done when:** `calendar` panel + `calendar-display` slice; rhf+zod pane; save notifies; stories; Apps nav is Calendar (Mail hidden)
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/settings-core/src/settings-registry.test.ts src/settings-core/src/use-settings-sidebar-model.test.tsx src/settings-core/src/use-settings-calendar-form-saved.test.tsx src/settings-core/src/settings-calendar-pane.test.tsx src/settings-core/src/settings-dialog-footer.test.tsx`
- **Parallel with:** none

### Chunk C: Apply prefs to Calendar views

- **id:** `grid-wiring`
- **Skill:** workspace
- **Inputs:** Chunk A
- **Done when:** controller subscribes to calendar slice saves; locale/timezone/weekStart/visibleHours reach Lit; zoned events convert into the display zone; new timed events use the chosen zone; viewDateRange honors weekStart
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-display-prefs.test.tsx src/calendar-core/src/calendar-event-model.test.ts src/calendar-core/src/calendar-surface-display.test.tsx src/calendar-core/src/calendar-editor-model.test.ts src/lib/calendar-elements/CalendarViewGroup/CalendarViewGroup.visible-hours.test.tsx`
- **Parallel with:** chunk B

## Test plan

- [ ] Vitest for prefs parse/write, week-start resolve, form save bus
- [ ] Registry/nav/dialog stories: Calendar under Apps, Mail hidden, no Notifications
- [ ] Controller/surface: locale, timezone, weekStart, visibleHours after notify; zoned events shift on the grid
- [ ] Local apps done gate before push
