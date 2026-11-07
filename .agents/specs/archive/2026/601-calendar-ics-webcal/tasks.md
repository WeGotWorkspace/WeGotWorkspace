# Engineering tasks — ICS / webcal subscribe and publish

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Closing issues: Epic #601 · Tasks #602 #603 #604 · Goal #522 (context only)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `api-ics-webcal-contract` | builder | api | `packages/api/openapi/openapi.json`, `packages/api/openapi/schemas/calendars/calendar.json` | `pnpm --filter @wgw/api run openapi:build-json` | done |
| `api-ics-webcal-subscribe` | builder | api | `packages/api/app/Services/Calendars/`, `packages/api/routes/api.php`, `packages/api/database/migrations/wgw/`, `packages/api/tests/Feature/Calendars/` | `cd packages/api && composer test -- --filter Calendars` | pending |
| `api-ics-webcal-publish` | builder | api | `packages/api/app/Services/Calendars/`, `packages/api/app/Http/Controllers/Api/V1/Calendars/`, `packages/api/routes/api.php`, `packages/api/tests/Feature/Calendars/` | `cd packages/api && composer test -- --filter Calendars` | pending |
| `apps-ics-webcal-ui` | builder | workspace | `packages/apps/src/calendar-core/src/calendar-workspace.tsx`, `calendar-calendar-dialog.tsx`, `calendar-types.ts`, `use-calendar-controller.ts` | `pnpm --dir packages/apps exec vitest run calendar-core` | done |
| `verify-ics-webcal` | verifier | testing | merged tree | `pnpm test:api-done-gate` + `pnpm test:apps-done-gate` + verify-issue #601 | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and `tools/worktree-agent.sh` names if split.
- Subscribe and publish API chunks may run in parallel **after** the contract chunk; do not edit the same OpenAPI path nodes concurrently.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **#601 / #602–#604 first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Worktree for this planning branch: `../sabre-installer-calendar-ics-webcal` · `feat/calendar-ics-webcal` · dev `:5198`.
