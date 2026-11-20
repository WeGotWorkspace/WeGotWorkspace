# Engineering tasks — Two-factor sign-in (TOTP) and app passwords

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-app-passwords-api` | builder | api, security | `packages/api/app/Services/Auth/AppPasswordService.php`, `packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php`, `packages/api/app/Services/Meet/MeetRequestAuth.php`, `packages/api/app/Http/Controllers/Api/V1/Settings/AppPasswordsController.php`, `packages/api/database/migrations/wgw/`, `packages/api/openapi/` | `php scripts/done-gate.php` and `pnpm check:api-types` |
| `chunk-b-app-passwords-ui` | builder, review by Wouter | apps-ui, storybook | `packages/apps/src/settings-core/src/settings-security-pane.tsx`, `packages/apps/src/settings-core/src/register-builtin-settings.tsx`, `packages/apps/src/lib/api/wgw/settings.ts` | `pnpm --dir packages/apps exec vitest run src/settings-core` |
| `chunk-c-totp-api` | builder | api, security | `packages/api/app/Services/Auth/` (TOTP, challenges, recovery codes, fail counter), `packages/api/app/Services/Auth/AuthTokenService.php`, `packages/api/app/Http/Controllers/Mcp/OAuthSessionController.php`, `packages/api/app/Http/Controllers/Api/V1/Auth/MfaChallengeController.php`, `packages/api/app/Http/Controllers/Api/V1/Settings/TotpSettingsController.php`, `packages/api/routes/api.php`, `packages/api/routes/console.php` | `php scripts/done-gate.php` and `pnpm check:api-types` |
| `chunk-d-sign-in-step` | builder, review by Wouter | apps-ui, client-transport | `packages/apps/src/login-core/src/`, `packages/apps/src/lib/api/wgw/auth-login.ts`, `packages/apps/src/lib/api/wgw/http.ts` | `pnpm --dir packages/apps exec vitest run src/login-core src/lib/api/wgw` |
| `chunk-e-security-settings-ui` | builder, review by Wouter | apps-ui, storybook | `packages/apps/src/settings-core/src/`, `packages/apps/src/admin-core/src/admin-users-pane.tsx` | `pnpm --dir packages/apps exec vitest run src/settings-core src/admin-core` |
| `chunk-f-docs-e2e` | builder | document, testing | `packages/api/docs/api-auth.md`, `docs/two-factor-authentication.md`, `packages/apps/e2e/two-factor.spec.ts` | `pnpm --filter @wgw/apps exec playwright test e2e/two-factor.spec.ts` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- No chunk starts while its checkbox under Open decisions in plan.md is open.
- A and C are not UI and can land after review, green CI and their own tests. B, D and E are visible UI and wait for Wouter.
- #984 stays open as the reference until chunk E lands. Take code from it file by file; do not merge it.
