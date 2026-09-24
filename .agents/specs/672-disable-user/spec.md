Source: #672 (body-hash: 6efc36bf)
Goal: #386

# Disable / suspend users

Technical translation of Task [#672](https://github.com/WeGotWorkspace/wegotworkspace/issues/672). Product context: Goal [#386](https://github.com/WeGotWorkspace/wegotworkspace/issues/386) (manage users; disable/suspend is the remaining success signal). Create/edit/delete already ship; this work adds `users.enabled` and rejects disabled accounts on every live auth path.

## Goal

Admins can disable a user without deleting their data. While `users.enabled` is false, the account cannot obtain tokens and cannot authenticate on REST/JMAP bearer **or** Sabre DAV (Basic + cookie). Cookie HMAC/expiry alone is not enough — `SabreUiAuthGate::validatedUsernameFromRaw` must look up `users.enabled` on every request. Re-enable restores login. The Admin Users pane exposes a disable/enable control beside delete.

## Non-goals

- SSO (#395), password recovery (#389), deleting data on disable, IdP sync
- Audit trail of who disabled/re-enabled whom and when
- Tearing down already-open long-lived connections (WebDAV keep-alive / HTTP/2, JMAP EventSource). “Immediately” means the next authenticate, not a live-connection kill. JMAP Push (`eventSourceUrl`) is already a 501 stub.

## Affected packages

- `packages/api` — wgw migration `users.enabled`; OpenAPI admin user schemas; shared enabled guard; provisioner PATCH; token issue/refresh; bearer + Sabre Basic/cookie; feature tests
- `packages/apps` — Admin Users pane toggle; types/mutations/live client/mocks; Storybook `vitest-ci` play

## Technical constraints

- Next free `WgwSchemaMigrator::CURRENT_SCHEMA_VERSION` and next unused `database/migrations/wgw/` timestamp at implement time. Do not rewrite baseline `000010`. Assert the column in `WgwSchemaParityTest`.
- Shared `UserEnabledGuard` (or `User::isEnabled()`) so REST/JMAP and Sabre cannot drift.
- On `enabled: false`, revoke that user’s refresh tokens (`RefreshTokenRepository::revokeAllForUsername`).
- Cookie path: after HMAC/expiry in `SabreUiAuthGate::validatedUsernameFromRaw`, look up `users.enabled` and return null when false. Extra keyed DB lookup per DAV request is acceptable.
- Admin cannot disable themselves (same lockout class as `GroupDirectoryService` “cannot remove your own administrator access”).
- Disabled-user 401 shape matches bad credentials. Re-enable restores both REST and Sabre. Delete remains hard-delete.
- Run `pnpm --filter @wgw/api run typegen` after OpenAPI change. UI threads `enabled` through generated types.

## Edge cases

- Existing users and new users default `enabled: true`.
- A still-valid `sabre_ui_auth` cookie must fail on the next request after disable (do not wait for expiry or re-login).
- Self-disable via `PATCH /admin/users/{username}` returns 400.
- In-flight keep-alive / EventSource connections are not killed (non-goal).
- Disabled users remain in the Admin Users list and look disabled.
