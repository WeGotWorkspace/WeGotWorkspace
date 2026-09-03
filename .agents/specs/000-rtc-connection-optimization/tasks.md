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
| `principal-reuse` | phase-3b agent | workspace, meet | `packages/apps/src/lib/rtc/session/principal-link-registry.ts`, `packages/apps/src/lib/rtc/session/collab-reuse-envelope.ts`, `packages/apps/src/presence-core/`, `packages/apps/src/text-editor-core/docs-collab/` | apps Vitest (`collab-reuse`, `principal-link-registry`, `docs-collab-principal-reuse`, `docs-rtc-session`, `presence-rtc-session`, `docs-collab-mesh-warnings`) + live items 1–3 below | in progress (tests 2–3 pass; live 1–3 blocked by collab 401) |

## Notes

- Chunk `id` values match `plan.md`.
- Update **status** as chunks complete (`pending` → `done`).
- Full done gates (`pnpm test:api-done-gate` / `pnpm test:apps-done-gate`) run by the final verification agent, not per chunk.

## Phase 3b live + test verification (must all pass)

`?rtcDebug=1` stays a number. Isolated cookies: cursor-ide-browser vs Chrome DevTools. Doc: `/docs?file=groups%2Fadministrators%2Fteam-notes.md` on `http://127.0.0.1:5173`.

1. **Reuse-hit.** Both users idle until principal mesh is up; one opens the doc, the other follows. Console: `reuse-hit` then `dc-open` `{ reused: true }` — not a fresh ICE round.
2. **Bidirectional Yjs over reuse.** A→B and B→A updates appear in the other doc on the reused DC; sender must not apply their own echo. Tests must assert delivery, not only “no error UI”.
3. **Principal-link drop mid-session.** Unregister / close the principal PC during active collab. No warning banner. Sync continues via fresh ICE. Log: `reuse-miss` `{ reason: "principal-link-gone" }`.
