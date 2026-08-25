# Engineering tasks — Persist Calendar view preferences

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `calendar-view-prefs` | builder | workspace | `packages/apps/src/calendar-core/src/calendar-view-prefs.ts`, `calendar-route-search.ts`, `use-calendar-route-sync.ts`, `use-calendar-controller.ts` | `pnpm --dir packages/apps test -- src/calendar-core/src/calendar-view-prefs.test.tsx src/calendar-core/src/calendar-route-search.test.ts src/calendar-core/src/use-calendar-route-sync.test.tsx src/calendar-core/src/use-calendar-view-prefs.test.tsx` | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
