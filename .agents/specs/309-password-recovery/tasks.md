# Engineering tasks — Self-service password recovery

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `spec-309` | planner | plan-feature | `.agents/specs/309-password-recovery/`, issue #309 | `gh issue view 309 --json body --jq .body \| shasum -a 256` vs spec `Source:` | done |
| `api-password-recovery` | builder | api | `packages/api/openapi/openapi.json`, `packages/api/app/Services/Auth/`, `packages/api/routes/api.php`, `packages/api/database/migrations/wgw/`, `packages/api/tests/Feature/Auth/` | `pnpm test:api-done-gate` | done |
| `ui-password-recovery` | builder | apps-ui | `packages/apps/src/login-core/`, `packages/apps/src/wegotworkspace/src/wegotworkspace-routes.tsx`, `packages/apps/src/lib/api/wgw/http.ts`, `packages/apps/src/admin-core/src/admin-email-delivery-pane.tsx` | `pnpm test:apps-done-gate` | done |
| `chunk-verify` | verifier | testing | whole branch | verify-issue #309 + both done gates | done |

## Notes

- Chunk `id` values must match `plan.md` and worktree-agent names (`feat/<id>` if splitting later).
- Implementation stays on `feat/password-recovery` unless a chunk is split to its own worktree.
- On scope change: update **#309 first**, then re-sync spec/plan/tasks and the `Source:` body-hash.
