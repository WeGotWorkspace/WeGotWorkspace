# Calendar: React shell with embedded Lit views

Decision record for engineers (human and AI) who open the Calendar code and wonder whether to clean up, split or rewrite part of it.

**Status:** accepted, 2026-11-04 · **Tracker:** [#1640](https://github.com/WeGotWorkspace/wegotworkspace/issues/1640) · **Background:** [`.agents/specs/000-calendar-app/spec.md`](../../.agents/specs/000-calendar-app/spec.md) (amendment of 2026-08-13)

---

## Decision

Calendar is built with two screen technologies: a React app around a set of Lit web components. This is a known, accepted asymmetry.

- The Lit components will move to React **in one go**, and their known design flaws are removed in that same rewrite.
- That rewrite is **not now**. It is not scheduled during the pioneer programme.
- Until then, the two guidelines below apply to every change in Calendar.

## The three trees

Calendar is one feature spread over three trees in `packages/apps/src`. Line counts are `.ts`/`.tsx` lines including tests (`wc -l`, 2026-10-26).

| Tree | Lines | What it is |
|------|-------|-----------|
| [`calendar-core/`](../../packages/apps/src/calendar-core/) | 39,648 (17,391 non-test) | React app: workspace, controller, dialogs, sidebar |
| [`lib/calendar-elements/`](../../packages/apps/src/lib/calendar-elements/) | 19,907 (13,975 non-test) | Vendored Lit web components (week, month and timeline views), embedded in React through React 19 custom-element interop |
| [`lib/calendar-engine/`](../../packages/apps/src/lib/calendar-engine/) | 2,751 (1,991 non-test) | Pure reducer for event state |

Together that is about 62,300 lines, roughly 18% of the 339,632 `.ts`/`.tsx` lines in `packages/apps/src`. The two largest source files in the repository are Lit components: `CalendarTimelineView/CalendarTimelineView.ts` (2,376) and `TimeLine/TimeLine.ts` (2,318).

## Why the split stays

- **The Lit views carry the interaction set.** The original plan ported the Lit UI to React. The amendment of 2026-08-13 in the calendar spec reversed that: the clean-room React port lacked drag create/move/resize, the year view, list presentations and overflow popovers, which the Lit views already had. The ported React views were deleted and the Lit views embedded instead.
- **A partial rewrite costs twice.** Splitting or restructuring a Lit component now produces code that the full React rewrite throws away. [#843](https://github.com/WeGotWorkspace/wegotworkspace/issues/843) (split or branch-test the calendar god-files) was closed as not planned on 2026-10-01 for that reason.
- **Users do not see the split.** Both technologies render into the same workspace shell with the same tokens. The cost is maintenance, not product quality.

## Guidelines until the rewrite

1. **Pull outward, not inward.** Design tokens and domain logic move out of `lib/calendar-elements/` into shared places: tokens into [`styles.css`](../../packages/apps/src/styles.css), event state into `lib/calendar-engine/`, other domain rules into `lib/` domain modules. Do not add new domain logic inside `lib/calendar-elements/` (that includes its `domain/` folder). The goal is that the eventual rewrite only has to replace rendering and interaction.
2. **Leave the Lit internals alone.** Do not restructure, split or re-style the internal structure of the Lit components. Bug fixes inside them are fine. Refactors are not, because the rewrite would throw them away.

## What new code should do

- New Calendar features go in `calendar-core/` (React) or a shared `lib/` module. They talk to the Lit views through their existing properties and events.
- A bug fix inside a Lit component stays as small as the fix needs. It must not grow the file: the file-size baseline still applies.
- Reviewers and agents do not propose splitting the Lit files as a size fix. Five of them are on [`tools/file-size-baseline.tsv`](../../tools/file-size-baseline.tsv) with this note as their reason: `CalendarTimelineView.ts`, `TimeLine.ts`, `TimedEventInteractionController.ts`, `EventCalendar.ts` and `CalendarViewBase.ts`.

## When to revisit

Reopen this decision when one of these is true:

- The React rewrite of the Calendar views is scheduled as its own piece of work, after the pioneer programme.
- A required Calendar feature cannot be built without changing the internal structure of a Lit component.
- The Lit dependency or React 19 custom-element interop stops being maintained, or blocks a framework upgrade.
- A bug class keeps coming back in the Lit views because of their structure, so that small bug fixes no longer hold.

The rewrite itself needs a spec under `.agents/specs/` before it starts.
