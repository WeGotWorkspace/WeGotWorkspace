# Engineering tasks — RTC cross-app connection optimization

**Not** a copy of a GitHub issue checklist. Tracks which agent/chunk implements which technical piece on the shared `feat/rtc-connection-optimization` branch.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `collab-join-authz` | phase-0 agent | api, testing | `packages/api/app/Services/Collab/`, `packages/api/tests/Feature/Collab/` | `vendor/bin/phpunit tests/Feature/Collab tests/Feature/Meet` (packages/api) | done |
| `meet-persistent-call` | phase-1 agent | workspace, meet | `packages/apps/src/wegotworkspace/`, `packages/apps/src/meet-core/` | `pnpm test` (packages/apps) | done |
| `poll-efficiency` | phase-1 agent | api, apps-ui | `packages/apps/src/lib/rtc/session/peer-mesh.ts`, `packages/api/app/Services/Rtc/Signaling/` | apps Vitest + API poll feature tests | done |
| `collab-linger-gossip` | phase-2 agent | workspace | `packages/apps/src/text-editor-core/docs-collab/` | apps Vitest | done |
| `principal-room` | phase-3a agent | api, workspace | `packages/api/app/Services/Rtc/`, `packages/api/app/Services/Principal/`, `packages/api/database/migrations/wgw/`, `packages/apps/src/lib/rtc/`, `packages/apps/src/presence-core/` | API feature tests + apps Vitest | done |

## Notes

- Chunk `id` values match `plan.md`.
- Update **status** as chunks complete (`pending` → `done`).
- Full done gates (`pnpm test:api-done-gate` / `pnpm test:apps-done-gate`) run by the final verification agent, not per chunk.
