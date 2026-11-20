# Two-factor sign-in (TOTP) and app passwords

Derived from [spec.md](./spec.md). Chunk layout for sequential API work with UI chunks alongside.

## Goal

Rebuild the opt-in TOTP sign-in step and named app passwords from draft PR #984 on current `main`, in pieces that each leave `main` shippable, with the screens built on the current suite UI norm instead of ported.

## Budget

No milestone (Wouter, 2026-11-19: "never mind the milestone, just build"). Draws from build time next to the open Pioneer programme work; displaces nothing scheduled. The UI chunks (B, D, E) draw from Wouter's review time.

## Non-goals

- Admin policy to require two-factor (off / admins / everyone). Decided 2026-11-19: not in this work.
- Step-up token replacing `currentPassword`.
- Passkeys, SMS or email codes, remembered devices, a home-screen prompt.
- Merging or rebasing #984 itself.

## What exists

- Nothing of two-factor or app passwords is on `main`. A search of `packages/api/app` and `packages/apps/src` for `totp`, `app password` and `two-factor` finds one file, for a comment that expects a later step-up token. `path: packages/api/app/Http/Controllers/Api/V1/Settings/ProfileController.php:99`
- Web sign-in validates the password and issues a token pair in one call. `path: packages/api/app/Services/Auth/AuthTokenService.php:35`
- The refresh token goes out as an HttpOnly cookie from the token controller. `path: packages/api/app/Http/Controllers/Api/V1/Auth/TokenController.php:30`
- A sign-in session is a refresh-token family, and the access token names it in `sid`. `path: packages/api/app/Services/Auth/AuthTokenService.php:225`
- A rotated refresh token is replayed for 60 seconds, then a reuse revokes only its family. `path: packages/api/app/Services/Auth/RefreshTokenRepository.php:14` and `:209`
- One service ends every session of a user: refresh tokens, Passport grants, push subscriptions, UI cookie epoch. `path: packages/api/app/Services/Auth/UserSessionRevoker.php:20`
- A password change calls it and the client then signs out and sends the user to the login screen. `path: packages/api/app/Http/Controllers/Api/V1/Settings/ProfileController.php:61`, `path: packages/apps/src/settings-core/src/use-settings-profile-form.tsx:195`
- Assistant connect signs in with a password and starts a web session. `path: packages/api/app/Http/Controllers/Mcp/OAuthSessionController.php:51`
- DAV Basic checks the account password itself, with the APCu verified-password memory. `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:39` and `:57`
- Meet Basic checks through the shared validator. `path: packages/api/app/Services/Meet/MeetRequestAuth.php:73`
- Sign-in and protocol limits are separate keys in the cache rate limiter. `path: packages/api/app/Services/Auth/LoginRateLimiter.php:29` and `:58`
- The client signs in through one function. `path: packages/apps/src/lib/api/wgw/http.ts:466`
- Today's client throws on a sign-in body without `access_token`, so an `mfa_required` answer locks a user out of the web app until chunk D is on `main`. `path: packages/apps/src/lib/api/wgw/http.ts:243`
- The login screen is one form inside `AuthenticationPage`. `path: packages/apps/src/login-core/src/login-screen.tsx:108`
- Settings panels are registered into groups; `account` holds Profile. `path: packages/apps/src/lib/models/settings-types.ts:32`, `path: packages/apps/src/settings-core/src/register-builtin-settings.tsx:56`
- The newest wgw migration is numbered `000951` on 2026-11-19. `path: packages/api/database/migrations/wgw/2026_11_18_000951_wgw_create_task_yjs_state.php:1`
- [#984](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/984) conflicts with `main` in more than 30 files, and nine files it edits were deleted or moved on `main` (for example `path: packages/apps/src/login-core/src/login-screen.css`). `cmd: git merge-tree --write-tree --name-only origin/main origin/cursor/totp-2fa-app-passwords-66f2`
- To verify: the 2026-11-12 comment on [#984](https://github.com/WeGotWorkspace/WeGotWorkspace/pull/984) says the app-passwords part is ported onto current `main` and green. No such branch or PR is on `origin` (`cmd: git branch -r | grep -iE 'app-?pass|mfa'` lists only the #984 branch).

## Considered

Considered: merging `main` into #984, or rebasing it — rejected because the sign-in code it changes was replaced underneath it (refresh cookie, token families, sign-out on password change) and nine of the files it edits no longer exist.

Considered: #984's `session_generation` column on users and refresh tokens — rejected because `UserSessionRevoker::revokeAll()` plus `ui_session_epoch` already end every session, and family-scoped reuse detection already keeps a bulk revoke from looking like theft.

Considered: keeping the current browser signed in after turning two-factor on (as #984 did, by reissuing a pair in the response) — rejected in favour of signing out everywhere, because that is what a password change does on `main` and the first sign-in with a code proves the authenticator works. Decided by Wouter, 2026-11-19.

Considered: the existing `LoginRateLimiter` for failed codes — used for the IP and user-and-IP limits; a separate per-user code counter is added because the sign-in user limit resets in 15 minutes and a 6-digit code needs a harder ceiling.

Considered: bringing back the admin policy that requires two-factor (off / admins / everyone), asked for on #984 for hosting — left out (decided by Wouter, 2026-11-19) because enforcement needs a forced-setup path at sign-in that opt-in does not; it becomes its own Task after this work.

Considered: taking the app-passwords port offered in the 2026-11-12 comment on #984 as chunk A — not taken (decided by Wouter, 2026-11-19); no such branch is on `origin`, and chunk A is built here from #984's design.

Considered: porting #984's screens (`totp-wizard.tsx`, `settings-security-*.tsx`, `admin-mfa-dialogs.tsx`) — rejected because they predate the suite UI norm, the dialog norm and the Admin/Settings layout; the flows are kept and the screens are rebuilt from current components.

Considered: porting #984's outbox edits — rejected because they only handled the removed "setup required" error; with opt-in two-factor no background request ever meets a challenge.

## Affected packages

- packages/api
- packages/openapi-types
- packages/apps
- docs, packages/api/docs

## Dependencies

1. A (app passwords API) first.
2. B (app passwords UI) after A.
3. C (TOTP API, all password callers) after A. C must not land before B is on `main`: without B a user who turns two-factor on has no way to create an app password and their DAV clients stop.
4. D (sign-in step UI) and E (Security settings and admin UI) are built in parallel on C's contract.
5. Landing order on `main`: A → B → C → D → E. C lands only after B; D lands right after C; E lands only after B, C and D are on `main`. E is the chunk that lets a user turn two-factor on from the product; if E landed before D, a user who turned it on would be signed out and the login screen could not take the code.
6. F (docs and live e2e) last.

## Open decisions

- [x] 0 (all chunks): no milestone; build now — decided 2026-11-19. See Budget.
- [x] 1 (C, E): admin policy off / admins / everyone — decided 2026-11-19: out of this work. See Non-goals and Considered.
- [x] 2 (C, E): after turning two-factor on, the current browser is signed out too, like a password change — decided 2026-11-19. See Considered.
- [x] 3 (A): chunk A is built here, not taken from the port offered on #984 — decided 2026-11-19. See Considered.
- [x] 4 (A, C): Goal WeGotWorkspace/Product#152, Epic #2270 and Tasks #2271–#2276 filed 2026-11-19.

## Invariants

- A user without two-factor signs in with one request and gets the same token response and refresh cookie as today. A wrong change breaks every existing client at sign-in. Proof: `path: packages/api/tests/Feature/Auth/RefreshTokenBehaviorTest.php`, plus a new assertion in `path: packages/api/tests/Feature/Auth/MfaLoginTest.php` that the response for such a user has `status: ok` and the cookie.
- A DAV or Meet client of a user without two-factor keeps working with the account password after chunk A. A wrong change locks out every calendar and contacts client. Proof: `path: packages/api/tests/Feature/Dav/DavBasicAuthThrottleTest.php`, `path: packages/api/tests/Feature/Meet/MeetBasicAuthThrottleTest.php`.
- The DAV verified-password memory never stores an app password or anything outside APCu. A wrong change puts a credential check result on disk. Proof: `path: packages/api/tests/Feature/Auth/AppPasswordTest.php` assertion `test_app_password_is_not_remembered` (new in chunk A).
- With two-factor on, no route turns a password alone into a session. A wrong change is a bypass. Proof: `path: packages/api/tests/Feature/Auth/MfaLoginTest.php` (new in chunk C), one case each for `auth/token`, `oauth/session`, DAV Basic and Meet Basic, asserting no token, no web session, 401 on Basic.
- An `oauth` challenge is refused on the API verification route and a `spa` challenge on `oauth/session`. A wrong change lets one be redeemed as the other. Proof: `path: packages/api/tests/Feature/Auth/MfaLoginTest.php` assertion `test_challenge_client_is_enforced` (new in chunk C).
- A reused refresh token after a bulk revoke still revokes only its own family. A wrong change signs every device out on one stale tab. Proof: `path: packages/api/tests/Feature/Auth/RefreshTokenBehaviorTest.php`.
- A password change still ends every session. Proof: `path: packages/api/tests/Unit/Services/Auth/UserSessionRevokerTest.php`, `path: packages/api/tests/Feature/Settings/SettingsProfileTest.php`.
- Every new route is in the role-access matrix. Proof: `path: packages/api/tests/Architecture/RoleAccessMatrixTest.php`.
- After chunk A, `main` works without B. Proof: `cmd: php scripts/done-gate.php` in packages/api.
- After chunk C, `main` works without D and E for every user who did not call the enrollment API by hand: no screen turns two-factor on before E, so no such user has an enabled `user_mfa` row. D lands right after C to close that window. Proof: `cmd: php scripts/done-gate.php` and `cmd: pnpm test:apps-done-gate`.
- After an admin or CLI reset, the password alone signs in again. A wrong change leaves the user locked out. Proof: `path: packages/api/tests/Feature/Auth/MfaAdminTest.php` assertion `test_reset_restores_password_sign_in` (new in chunk C).
- A start while two-factor is on does not replace or return the live secret. A wrong change lets a password alone turn the second step off. Proof: `path: packages/api/tests/Feature/Auth/MfaSettingsTest.php` assertion `test_start_refused_while_enabled` (new in chunk C).

## Chunks

### Chunk A: App passwords API

- **Issue:** #2271
- **id:** `chunk-a-app-passwords-api`
- **Skill:** api, security
- **Inputs:** DAV Basic check `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:39`; Meet Basic check `path: packages/api/app/Services/Meet/MeetRequestAuth.php:73`; protocol limiter `path: packages/api/app/Services/Auth/LoginRateLimiter.php:58`; current-password check to reuse `path: packages/api/app/Http/Controllers/Api/V1/Settings/ProfileController.php:97`
- **Done when:** `app_passwords` and `users.dav_password_used_at` exist; `GET/POST settings/app-passwords`, `DELETE settings/app-passwords/{id}` and `POST settings/app-passwords/revocations` are in OpenAPI and the role matrix; DAV and Meet Basic accept an app password first and still accept the account password; a revoked or other user's app password is refused; an app password is refused on `auth/token` and `oauth/session`; the security checklist is answered in the PR.
- **Verify with:** `pnpm --filter @wgw/api exec phpunit --filter 'AppPassword|DavBasicAuthThrottle|MeetBasicAuthThrottle'`, then `php scripts/done-gate.php`, then `pnpm check:api-types`
- **Parallel with:** none

### Chunk B: App passwords in Settings

- **Issue:** #2272
- **id:** `chunk-b-app-passwords-ui`
- **Skill:** apps-ui, storybook
- **Inputs:** panel registration `path: packages/apps/src/settings-core/src/register-builtin-settings.tsx:56`; group list `path: packages/apps/src/lib/models/settings-types.ts:32`
- **Done when:** a Security panel in the `account` group lists app passwords (name, created, last used, client) with the shared list look; a create dialog asks for a name and the account password and shows the new password once with a copy button; one row and all rows can be revoked with a confirm; stories cover empty, filled, just-created and error states; Wouter has reviewed the screens.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/settings-core`, Storybook Features/Settings/Panes/Security, and a browser run against a local API: create, use it from `curl -u` on a DAV URL, revoke, see the 401.
- **Parallel with:** none

### Chunk C: TOTP API and every password caller

- **Issue:** #2273
- **id:** `chunk-c-totp-api`
- **Skill:** api, security
- **Inputs:** web sign-in `path: packages/api/app/Services/Auth/AuthTokenService.php:35`; assistant sign-in `path: packages/api/app/Http/Controllers/Mcp/OAuthSessionController.php:51`; session revoke `path: packages/api/app/Services/Auth/UserSessionRevoker.php:20`; the two Basic callers from chunk A
- **Done when:** `user_mfa`, `mfa_recovery_codes` and `auth_challenges` exist; the `settings/totp` routes (start, confirm, disable, recovery-code replacement), `POST auth/mfa-challenges/{challenge}/verification`, `POST auth/mfa-challenges/{challenge}/replacement`, the two-step `POST /oauth/session`, the admin reset route and `wgw:mfa:reset` work as spec.md describes; after an admin or CLI reset `auth/token` answers `status: "ok"` with tokens; start answers 409 while two-factor is on; `auth/token` and `oauth/session` answer with a challenge for a user with two-factor on; DAV and Meet Basic refuse that user's account password; the per-challenge and per-user limits hold on a second request; turning on, replacing and admin reset end every session; `me` and the settings state carry `mfa.enabled`; the security checklist is answered in the PR.
- **Verify with:** `pnpm --filter @wgw/api exec phpunit --filter 'MfaLogin|MfaSettings|MfaAdmin|McpOAuthSession|RefreshTokenBehavior|SettingsProfile'`, then `php scripts/done-gate.php`, then `pnpm check:api-types`
- **Parallel with:** `chunk-b-app-passwords-ui` for building only; C lands after B is on `main`.

### Chunk D: Code step at sign-in

- **Issue:** #2274
- **id:** `chunk-d-sign-in-step`
- **Skill:** apps-ui, client-transport, storybook
- **Inputs:** sign-in call `path: packages/apps/src/lib/api/wgw/http.ts:466`; login form `path: packages/apps/src/login-core/src/login-screen.tsx:108`
- **Done when:** the sign-in call returns a typed result (`ok`, `mfa_required`, `mfa_replace_required`) and lives outside `http.ts` so the file-size baseline holds; the login screen shows a code step inside `AuthenticationPage`, with a link to use a recovery code and the replacement steps after one; the same step works on the assistant connect variant; a pasted `123 456` is accepted; a locked or throttled answer shows when to try again; stories cover each state; Wouter has reviewed the screens.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/login-core src/lib/api/wgw`, Storybook Themes/Login, and a browser run in a fresh profile: sign in with a code, with a recovery code, and through assistant connect.
- **Parallel with:** `chunk-e-security-settings-ui` for building only; D lands right after C, before E.

### Chunk E: Two-factor in Settings and Admin

- **Issue:** #2275
- **id:** `chunk-e-security-settings-ui`
- **Skill:** apps-ui, storybook
- **Inputs:** the Security panel from chunk B; password dialog pattern `path: packages/apps/src/settings-core/src/use-settings-profile-form.tsx:169`; admin user actions `path: packages/apps/src/admin-core/src/admin-users-pane.tsx:171`
- **Done when:** the Security panel has a two-factor row that starts setup (account password, QR code and typed secret, a code, then recovery codes with copy and a confirmation that they are saved); setup warns when a DAV or Meet client recently used the account password and links to app passwords; turning off and replacing recovery codes each ask for a code; the panel shows how many recovery codes are left; the admin user list shows who has two-factor on and offers a reset with a confirm; after turning it on the user lands on the login screen with a message; stories cover each state; Wouter has reviewed the screens.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/settings-core src/admin-core`, Storybook Features/Settings/Panes/Security and Features/Admin, and a browser run: turn on with a real authenticator, sign in again, turn off, admin reset from a second account.
- **Parallel with:** `chunk-d-sign-in-step` for building only; E lands last, after B, C and D are on `main`.

### Chunk F: Docs and live e2e

- **Issue:** #2276
- **id:** `chunk-f-docs-e2e`
- **Skill:** document, testing
- **Inputs:** auth doc `path: packages/api/docs/api-auth.md:1`; assistant connect doc `path: docs/mcp-connect.md:1`
- **Done when:** `packages/api/docs/api-auth.md` and `packages/api/docs/sql-schema.md` describe the new routes and tables; `docs/two-factor-authentication.md` explains turning it on, app passwords for calendar and contacts apps, recovery codes, and the admin and CLI reset; a Playwright spec in the live tier generates codes from a known secret and covers turn on, sign in, recovery-code replacement, an app password on a DAV request, and admin reset; the same flows were run by hand in a fresh browser, with a second tab open, and in Safari.
- **Verify with:** `pnpm --filter @wgw/apps exec playwright test e2e/two-factor.spec.ts`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `php scripts/done-gate.php` (the composer done-gate times out locally at 900 s)
- [ ] API bypass tests, not only happy paths: password-only on each of the four sign-in callers; a challenge of the wrong client kind; a replayed code inside the same 30-second step; the sixth code on one challenge; the eleventh failure across challenges, then a correct code; a second request after a limit trips; a DAV account password that succeeded (warming the verified-password memory) is refused right after two-factor is turned on; an abandoned replacement leaves the recovery code spent
- [ ] API: a 429 carries `Retry-After` and the `throttled` code
- [ ] UI: mock-tier Storybook → Vitest for the sign-in result type and code formatting → `play` for the setup flow
- [ ] Live: one Playwright spec in the live tier (chunk F)
- [ ] By hand: fresh browser profile, second tab, Safari, a real DAV client with an app password, assistant connect

## Doc updates (only if user wants)

- `packages/api/docs/api-auth.md`, `packages/api/docs/sql-schema.md`
- `docs/two-factor-authentication.md` (new)
- A release note for the version that ships chunk E
