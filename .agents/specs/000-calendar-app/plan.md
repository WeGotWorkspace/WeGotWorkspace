# Calendar app — plan

Derived from [spec.md](./spec.md); chunk layout mirrors the approved build plan.

## Dependencies

1. Chunk A's e2e gate (unmodified client vs current `main`) before Chunk C starts.
2. Chunk B before D1/D2 (views/editor mount into the skeleton).
3. Chunk A before C (transport) and D1 (engine).
4. Chunk E last.

## Chunks

- **0 — spec-first setup:** this folder; issue drafts for Goal/Epic/Tasks (GitHub write unavailable in build env).
- **A — vendor:** `events-api` → `packages/apps/src/lib/calendar-engine/`, `jmap-client` → `packages/apps/src/lib/jmap-client/`, tests included; deps `rrule` + `@js-temporal/polyfill`; e2e harness rewired to the in-repo client (clone logic deleted). Done when vendored suites are green in the apps test run and the live e2e passes from the vendored client.
- **B — skeleton + registration:** `calendar-core` split shell (App/Workspace/controller/panes/css), mock bootstrap, mock stories; registration: `WORKSPACE_APP_IDS`, icons, routes, home tiles (live tile gated on `apps.calendars`), PWA manifest, `UiStaticServer` allowlist + tests, `sync-runtime-app-builds.mjs` module.
- **C — offline domain:** `lib/offline/calendars/` fifth instance + `use-calendar-api.ts`; jmap transport; conflict UX via the shared conflict queue hooks.
- **D1 — views:** month grid, week/day timed grids (stagger layout), agenda list; pure logic ported from `CalendarTimelineScale`/`StaggerLayout`; workspace CSS.
- **D2 — editing:** event editor pane (new UX) + click-to-create; drag interactions explicitly deferrable.
- **E — ship:** storybook coverage, apps done-gate, live e2e, docs; archive lit-calendar upstream (user-side).

## Test plan

Vendored suites run under the apps vitest setup. Offline domain gets contract + merge + flush tests mirroring `contacts-*`/`tasks-*` siblings. Views get pure-logic unit tests (scale/stagger/expansion windows) + story smoke tests. Gates: `pnpm test:apps-done-gate`, `check:storybook-coverage`, `tools/test-jmap-client-e2e.sh`, api done-gate for the allowlist change.
