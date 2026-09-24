# Engineering tasks — Disable / suspend users

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-task-spec` | builder | plan-feature | `.agents/specs/672-disable-user/` | `gh issue view 672`; body-hash `6efc36bf` | done |
| `chunk-b-api-enabled` | builder | api | `packages/api/database/migrations/wgw/`, `WgwSchemaMigrator.php`, `openapi/schemas/admin/users.json`, `AdminUserProvisionerService.php`, auth guards, feature tests | `composer test -- --filter 'AdminUsersTest\|AuthEndpointsTest\|SabreWebdavGetTest\|WgwSchemaParityTest'` | done |
| `chunk-c-admin-ui` | builder | apps-ui / storybook | `admin-users-pane.tsx`, `admin-types.ts`, `use-admin-mutations.tsx`, `admin.ts`, `admin-mock-operations.ts`, stories | story `vitest-ci` + Admin → Users browser | done |
| `chunk-v-verify` | builder | testing | — | verify-issue #672; API + apps done gates | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Chunk V (2026-08-31): spec `SYNC OK` (`6efc36bf`). `pnpm test:api-done-gate` hits Composer `process-timeout` 900s (`COMPOSER_PROCESS_TIMEOUT=0` does not override `composer.json`). Equivalent: `php scripts/done-gate.php` PASSED (greenfield + architecture 139 + PHPUnit 1491, 1 pre-existing deprecation, 2 skipped). `pnpm test:apps-done-gate` PASSED. Goal #386 stays OPEN / Adopted.
