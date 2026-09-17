# Disable / suspend users

Derived from [spec.md](./spec.md). Sequential chunks (UI needs OpenAPI typegen from API).

## Goal

Add `users.enabled`, reject disabled accounts on every live auth path (REST/JMAP bearer and Sabre Basic + cookie), and expose an Admin Users pane toggle beside delete.

## Non-goals

- SSO (#395), password recovery (#389), deleting data on disable, IdP sync
- Audit trail of disable / re-enable
- Killing already-open long-lived connections

## Affected packages

- packages/api
- packages/apps

## Dependencies

1. Chunk A (Task + spec) before implementation
2. Chunk B (API contract, schema, provision, auth) before UI — typegen required
3. Chunk C (Admin UI toggle) after B
4. Chunk V (verify) after B + C

## Chunks

### Chunk A: File Task + spec

- **id:** `chunk-a-task-spec`
- **Skill:** plan-feature, issue-filing
- **Inputs:** Goal #386; plan AC / non-goals
- **Done when:** worktree exists from `origin/main`; Task exists under #386 (not on Product Project); spec header hashes the Task body
- **Verify with:** `gh issue view <N>` parent #386; `Source:` body-hash matches `gh issue view <N> --json body --jq .body | shasum -a 256`
- **Parallel with:** none

### Chunk B: API contract, schema, provision, auth

- **id:** `chunk-b-api-enabled`
- **Skill:** api
- **Inputs:** Task #672 AC
- **Done when:** next-free migration + OpenAPI `enabled`; provisioner PATCH; shared enabled guard; token/refresh/bearer/Sabre Basic + cookie reject disabled; refresh tokens revoked on disable; self-disable 400; re-enable restores; tests cover token 401, bearer REST 401, Sabre PROPFIND 401 (Basic and still-valid cookie)
- **Verify with:** `cd packages/api && composer test -- --filter 'AdminUsersTest|AuthEndpointsTest|SabreWebdavGetTest|WgwSchemaParityTest'`
- **Parallel with:** none

### Chunk C: Admin UI toggle

- **id:** `chunk-c-admin-ui`
- **Skill:** apps-ui, storybook
- **Inputs:** generated `AdminUserSummary.enabled`
- **Done when:** toggle beside delete; mock ops persist `enabled`; story `vitest-ci` play covers click; disabled users stay in the list and look disabled
- **Verify with:** story `vitest-ci` + browser pass on Admin → Users
- **Parallel with:** none

### Chunk V: Goal + repo gates

- **id:** `chunk-v-verify`
- **Skill:** testing, verify-issue, clean-code
- **Inputs:** A + B + C
- **Done when:** Task #672 AC all PASS; Goal #386 success signals mapped (create/manage/delete still PASS, disable now PASS); API + apps done gates; #386 left open
- **Verify with:** verify-issue on #672; `run_api_done_gate` + `run_apps_done_gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI `enabled` → failing feature tests → implement → focused composer filter → `composer done-gate`
- [ ] UI: mock-tier Storybook `vitest-ci` play → browser Admin → Users
- [ ] verify-issue on Task #672 (not Goal #386 as Source)

## Doc updates (only if user wants)

- None unless a touched test fails because of stale docs
