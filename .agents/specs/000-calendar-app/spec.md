Source: ad-hoc (issue creation unavailable in the build environment — paste-ready drafts in [issue-draft.md](./issue-draft.md), then renumber this folder)

# Calendar app: vendor lit-calendar + port to apps architecture

Technical translation of the plan reviewed and approved 2026-08-13 (`/opt/cursor/artifacts/plans/calendar_app_vendor_and_port_320ea283.plan.md`). Absorb the external `lit-calendar` repo into this monorepo as first-class code and ship a calendar app that follows the established apps architecture end to end.

## Goal

A calendar workspace app in `packages/apps` backed by the JMAP envelope on `main` (PRs #432/#430, merge commits `2c8ee0e6`/`90fab3f4`): the framework-agnostic lit-calendar packages (`events-api` domain engine, `jmap-client`) vendored verbatim with their tests, the Lit UI ported to a React `calendar-core` on the workspace split shell, and offline support as the fifth instance of the Dexie offline/outbox idiom (after contacts, notes, tasks, docs).

## Non-goals

- Embedding Lit web components inside the React app (port, not embed).
- Tailwind anywhere in the monorepo — ported styles use the workspace CSS-variable system.
- Year view, list presentations beyond the agenda, and drag-create/move/resize in v1 (fast-follow; the pure `TimedEventInteractionController` pointer logic is ported when D2's drag scope lands).
- Push/real-time — the client polls, matching the envelope's documented non-goal.
- Changing the backend: `packages/api` is touched only for the `UiStaticServer` shell-route allowlist.

## Affected packages

- `packages/apps` (vendored libs, `calendar-core`, offline domain, registration, stories)
- `packages/api` (`UiStaticServer` allowlist + route tests only)
- `tools/` (live e2e harness rewired to the in-repo client)

## Technical constraints

- **Vendored verbatim where possible:** `lib/calendar-engine` (events-api: `EventsAPI` reducer, `expandEvents`, rrule adapter, Temporal date math) and `lib/jmap-client` (incl. `MockJmapServer`) keep their vitest suites. New deps: `rrule`, `@js-temporal/polyfill`.
- **Offline idiom parity:** `lib/offline/calendars/` mirrors the contacts/tasks file shapes (schema + version block, domain contract, offline store, outbox flush, conflict resolution, hybrid operations) with `jmap-client` as transport (session, `#ids` range batches, `/changes` states). `JmapEventsAdapter` is orchestration source material, not a runtime dependency of the store.
- **Shell:** split (`WorkspaceAppLayout`), `tasks-core` as the template; registration touchpoints per the plan's Chunk B list.
- **Storybook coverage gate:** every exported PascalCase UI surface needs mock-tier stories (`check:storybook-coverage`); keep exports deliberate.
- **Gate before offline work:** `tools/test-jmap-client-e2e.sh` green against current `main` HEAD.

## Edge cases

- Recurring events: expansion stays client-side via `calendar-engine` (`expandEvents`); composite ids (`{objectId}#{veventUid}`) are opaque strings end to end.
- Offline writes to recurring masters: exceptions/exclusions go through the reducer operations, queued in the outbox as master-level patches.
- `cannotCalculateChanges` on sync → full range refetch (adapter's `refetchAll` semantics) without dropping pending outbox entries.
- Calendar visibility/selection is device-local UI state (Dexie meta), not synced.
