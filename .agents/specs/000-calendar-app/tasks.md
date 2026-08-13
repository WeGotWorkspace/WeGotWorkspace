# Tasks — calendar app (vendor + port)

Engineering split per [plan.md](./plan.md). Branch: `feat/calendar-app` (off `main` @ `90fab3f4`).

| id | owner | skill | key paths | verify | status |
|----|-------|-------|-----------|--------|--------|
| cal-0-spec | builder | developer | `.agents/specs/000-calendar-app/` | folder complete; issue drafts ready | done |
| cal-a-vendor | builder | apps-ui, testing | `packages/apps/src/lib/calendar-engine/`, `packages/apps/src/lib/jmap-client/`, `tools/test-jmap-client-e2e.sh` | vendored vitest suites green; live e2e green vs `main` and vs vendored client | done |
| cal-b-skeleton | builder | workspace | `packages/apps/src/calendar-core/`, registration touchpoints, `packages/api/app/Ui/UiStaticServer.php` | mock stories render; `test:apps-done-gate`; api done-gate (allowlist) | done |
| cal-c-offline | builder | workspace, testing | `packages/apps/src/lib/offline/calendars/`, `packages/apps/src/calendar-core/use-calendar-api.ts` | contract/flush/merge tests mirroring contacts/tasks; done-gate | done |
| cal-d1-views | builder | apps-ui | `packages/apps/src/calendar-core/views/` | pure-logic unit tests; stories; done-gate | done |
| cal-d2-editing | builder | apps-ui | `packages/apps/src/calendar-core/` editor + create flow | stories + interaction tests; done-gate | done |
| cal-e-ship | builder | testing, document | stories coverage, docs, `tools/` | full done-gate; live e2e; docs review | done |

## Notes

- GitHub issue creation unavailable in the build environment: file Goal/Epic/Tasks from [issue-draft.md](./issue-draft.md), then renumber this folder and update `Source:`.
- Chunk C is gated on Chunk A's live e2e run against current `main` HEAD.
