# Self-service password recovery

Derived from [spec.md](./spec.md). Chunk layout for sequential then parallel implementation on `feat/password-recovery`.

## Goal

Ship the #309 guest reset-token API and login UI on top of `MailDeliveryService` (merged via #475).

## Non-goals

- See [spec.md](./spec.md) — no SMTP work, no extra takeover controls, no recovery toggle, no auto-login

## Affected packages

- `packages/api` | `packages/apps`

## Dependencies

1. Task #309 AC + this spec folder (this commit)
2. OpenAPI guest paths + capabilities field
3. API implementation (inject `MailDeliveryService`) and login UI may proceed in parallel after the contract is on the branch
4. Cross-chunk verify after A + B merge

## Chunks

### Chunk 0: Issue + spec

- **id:** `spec-309`
- **Skill:** plan-feature
- **Inputs:** Goal #389, Task #309, MailDelivery injection contract
- **Done when:** #309 has `- [ ]` AC; this folder exists with matching `Source:` body-hash
- **Verify with:** `gh issue view 309 --json body --jq .body | shasum -a 256` vs spec header
- **Parallel with:** none

### Chunk A: OpenAPI + API

- **id:** `api-password-recovery`
- **Skill:** api + testing
- **Inputs:** [spec.md](./spec.md); `MailDeliveryService::send(OutboundMessage): DeliveryResult`; existing auth controllers
- **Done when:** `POST /auth/password-resets`, `POST /auth/password-resets/{token}`, capabilities flag, `wgw` migration, `RefreshTokenRepository::revokeAllForUsername()`, feature tests (`Mail::fake()`); `composer done-gate`
- **Verify with:** `pnpm test:api-done-gate` (or `php vendor/bin/phpunit --filter PasswordRecovery` while iterating)
- **Parallel with:** none until OpenAPI is committed; then `ui-password-recovery`

### Chunk B: Login UI + admin copy

- **id:** `ui-password-recovery`
- **Skill:** apps-ui + storybook + accessibility
- **Inputs:** OpenAPI types / agreed paths from A
- **Done when:** `/login/forgot` and `/login/reset`, capability-gated link, Email delivery one-liner, Vitest + mock-tier stories; `pnpm test:apps-done-gate`
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/login-core src/wegotworkspace src/lib/api/wgw` then `pnpm test:apps-done-gate`
- **Parallel with:** `api-password-recovery` after contract is on the branch

### Chunk V: Cross-chunk verify

- **id:** `chunk-verify`
- **Skill:** verify-issue + code-review
- **Inputs:** merged A + B on `feat/password-recovery`
- **Done when:** each #309 AC has evidence; no spec drift; both done gates
- **Verify with:** [verify-issue](../../skills/verify-issue/SKILL.md) Task mode + [done-checklist](../../skills/developer/done-checklist.md)
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing `tests/Feature/Auth/PasswordRecoveryTest.php` → implement → `composer done-gate`
- [ ] API cases: unknown identifier, no email, `canSubmit` false, send with correct From/to/link, expiry, reused token, password &lt; 10, throttle 429, refresh tokens gone after reset. `Mail::fake()` only
- [ ] UI: mock-tier Storybook (request success, recovery-off, reset form, invalid token) + RTL
- [ ] Manual after merge: Admin Email delivery test-send, then forgot-password to a real mailbox; missing inbox is DNS first

## Doc updates (only if user wants)

- None beyond this spec folder unless asked. Operator mail docs already live in `packages/api/docs/mail-delivery.md`.
