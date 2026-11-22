# Engineering tasks — Lean-first sync

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

Reference case: the contacts-lean-first PR (Contacts lean fields). Read it, do not copy it; chunk E moves it onto the helper.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-s1-max-objects` | builder (after the product answer) | api | `packages/api/app/Services/Jmap/JmapCapabilities.php`, `Methods/Concerns/HandlesGetArguments.php`, `docs/realtime-capacity.md` | `php scripts/done-gate.php` (from `packages/api`) |
| `chunk-s2-projection-pushdown` | builder (optional, measure first) | api | `packages/api/app/Services/Jmap/Methods/ContactCardGetMethod.php`, `Concerns/HandlesGetArguments.php` | `php scripts/done-gate.php` (from `packages/api`) |
| `chunk-a-lean-record-guard` | builder | workspace | `packages/apps/src/lib/offline/lean-sync/` | `pnpm --dir packages/apps exec vitest run src/lib/offline/lean-sync` |
| `chunk-b-detail-runner` | builder | workspace | `packages/apps/src/lib/offline/lean-sync/detail-runner.ts`, `src/lib/offline/core/progressive-sync-runner.ts`, `cross-tab-lock.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/lean-sync` |
| `chunk-d-device-policy` | builder | workspace | `packages/apps/src/lib/offline/core/offline-device-settings.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/core/offline-device-settings.test.ts src/lib/offline/lean-sync/device-policy.test.ts` |
| `chunk-e-contacts` | builder | workspace | `packages/apps/src/contacts-core/`, `src/lib/jmap-client/contacts/JmapContactsClient.ts` | `pnpm --dir packages/apps exec vitest run src/contacts-core src/lib/offline/lean-sync` |
| `chunk-f-docs-drive` | builder | workspace | `packages/apps/src/lib/offline/docs/docs-body-sync.ts`, `src/lib/offline/drive/drive-content-sync.ts` | `pnpm --dir packages/apps exec vitest run src/docs-core src/lib/offline/docs src/lib/offline/drive src/lib/offline/lean-sync` |
| `chunk-g-notes` | builder | workspace | `packages/apps/src/notes-core/`, `src/lib/jmap-client/notes/JmapNotesClient.ts` | `pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/lean-sync` |
| `chunk-h-tasks` | builder | workspace | `packages/apps/src/tasks-core/`, `src/lib/api/wgw/tasks.ts` | `pnpm --dir packages/apps exec vitest run src/tasks-core src/lib/offline/lean-sync` |
| `chunk-i-calendar-events` | builder | workspace | `packages/apps/src/calendar-core/`, `src/lib/jmap-client/calendars/JmapCalendarsClient.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core src/lib/offline/lean-sync` |
| `chunk-j-harness-docs` | builder | testing | `packages/apps/playwright.traffic.config.mjs`, `docs/realtime-capacity.md` | `pnpm run check:agent-docs` |
| `chunk-v-verify` | verifier | testing | all of the above | verifier report + done checklist |

## Notes

- Chunk `id` values match the chunk letters in `plan.md`.
- Sonnet can build A, B, D and F–J from their Inputs / Done when / Verify with. S1 waits for the product answer; S2 starts with a measurement.
- On scope change: update #2338 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
