Source: #2270 (body-hash: f46ebb78)
Goal: WeGotWorkspace/Product#152

# Two-factor sign-in (TOTP) and app passwords

Epic #2270, with Tasks #2271–#2276. Draft PR #984 (branch `cursor/totp-2fa-app-passwords-66f2`, last commit 2026-09-30) is the design reference and is not mergeable: it is 4054 commits behind `main` and a trial merge conflicts in more than 30 files. This spec rebuilds the feature on current `main` in pieces.

## Goal

A user can turn on a second sign-in step with an authenticator app (TOTP, RFC 6238). Once it is on, a password alone no longer signs in on the web app or on the assistant connect screen, and DAV and Meet Basic clients sign in with a named app password instead of the account password. Recovery codes cover a lost phone. An admin can reset one user's authenticator.

## Non-goals

- An admin policy that requires two-factor (off / admins / everyone). Removed from #984 on 2026-09-30 and kept out of this work (decided 2026-11-19). `GET /api/v1/me` carries no `mfa.required`.
- A step-up token that replaces `currentPassword` on profile changes. The existing current-password check stays.
- Passkeys / WebAuthn, SMS or email codes, "remember this device".
- A home-screen prompt that suggests turning it on (the `mfa.suggest` field and snooze endpoint from #984 are dropped).
- Changes to the installer.

## Affected packages

- packages/api
- packages/openapi-types (generated)
- packages/apps
- docs, packages/api/docs

## Technical constraints

### Sign-in

- `POST /api/v1/auth/token` keeps its 200 token response for users without two-factor. For a user with two-factor on, a correct password answers 200 with `{ "status": "mfa_required", "challenge": "<64 hex>", "client": "spa" }`, sets no refresh cookie, and issues no tokens. OpenAPI models the two shapes as `oneOf` on a `status` discriminator; the existing token shape gains `status: "ok"`.
- `POST /api/v1/auth/mfa-challenges/{challenge}/verification` with `{ code }` or `{ recovery_code }` answers with the same token response and refresh cookie that `auth/token` gives today. It is a pre-auth route: the security skill checklist applies.
- A recovery code does not sign in. It answers `mfa_replace_required` with a new challenge; the user scans a new secret and confirms a code from it before tokens are issued. The used recovery code is spent either way.
- `POST /oauth/session` (assistant connect) runs the same password-then-challenge sequence and only calls `Auth::guard('web')->login()` after the code is verified. A challenge carries `client: spa | oauth`, and each route refuses a challenge of the other kind, so an `oauth` challenge cannot be redeemed for SPA tokens and the reverse.
- Refresh (`POST /auth/refresh`) never asks for a code. A session that was signed in before two-factor was turned on is ended at that moment instead (see Sessions).

### Every place that accepts a password

All five must be handled in the chunk that turns two-factor on; a missed one is a bypass.

| Caller | Today | With two-factor on |
|---|---|---|
| `AuthTokenService::issueFromCredentials` | password → tokens | password → challenge |
| `OAuthSessionController::store` (via `SabreUserProvider`) | password → web session | password → challenge |
| `SabrePdoBasicAndCookieAuth::validateUserPass` (DAV) | account password | app password only |
| `MeetRequestAuth` Basic branch | account password | app password only |
| `ProfileController::assertCurrentPassword` | re-auth on a signed-in session | unchanged (not a sign-in) |

### App passwords

- Table `app_passwords`: `username`, `name` (≤ 60), `token_hash` (sha256, unique), `created_at`, `last_used_at`, `last_used_client`, `revoked_at`.
- The plaintext is 16 random lowercase letters (about 75 bits), shown once, displayed in groups of four; spaces are stripped before hashing. One `hashNormalized()` helper is the only place that hashes, and tests call it.
- DAV and Meet Basic try an app password first, then the account password. The account password is refused only when that user has two-factor on. Without two-factor, nothing changes for existing clients.
- An app password is never accepted on `auth/token`, `oauth/session`, or the current-password check.
- The DAV verified-password memory (APCu only, never disk or database) stays as it is for account passwords. App passwords are a single indexed sha256 lookup and are not put in that memory.
- Creating an app password requires the account password and shares the sign-in rate limit. `last_used_at` is written at most once per five minutes per row.
- Failed Basic attempts with an app-password-shaped string count on the existing protocol limiter keys.

### TOTP

- Library `pragmarx/google2fa`. SHA-1, 6 digits, 30-second step, window of one step either side. `last_used_step` is stored and a code at or below it is refused, so a code cannot be replayed.
- Table `user_mfa`: `username` unique, `totp_secret` (Laravel `encrypted` cast, read only through the model property), `enabled_at`, `last_used_step`. A row with a secret and no `enabled_at` is a setup in progress and does not count as on.
- Table `mfa_recovery_codes`: sha256 of each code, `used_at`. Ten codes per set; replacing the set deletes the old one.
- Table `auth_challenges`: sha256 of the challenge id, `username`, `kind`, `client`, `pending_secret` (encrypted, replacement only), `attempts`, `expires_at` (10 minutes), `consumed_at`.
- Enrollment lives under `settings/totp`: start (account password → secret and `otpauth://` URI), confirm (account password and a code → recovery codes), disable (a current code), replace recovery codes (a current code). Confirm answers 409 when two-factor is already on. The QR code is drawn in the browser from the URI; the secret is never sent to a third party.
- `GET /api/v1/me` and the settings state gain `mfa.enabled`. No `mfa.required`, no `mfa.suggest`.

### Limits

- Each challenge stops after 5 failed codes.
- Failed TOTP and recovery codes share one per-user counter: 10 failures lock code entry for that user for one hour, including a later correct code, and delete that user's open challenges.
- Counters live in the shared cache store through `Illuminate\Cache\RateLimiter`, like `LoginRateLimiter`, never on a service instance. The IP and user-and-IP sign-in limits run before the code is checked.
- A 429 reaches the client as `throttled` with `Retry-After`.

### Sessions

- Turning two-factor on, replacing the authenticator, and an admin reset call `UserSessionRevoker::revokeAll()`: refresh tokens, Passport grants, push subscriptions and the UI cookie epoch. The browser that made the change is signed out too and signs in again with the new code, the same way a password change works on `main` today. #984's `session_generation` column and its "stale token without revoking the new pair" rule are not ported; token families on `main` cover it.
- Turning two-factor off revokes nothing. App passwords stay valid; the account password is accepted on Basic again.
- A password reset by email does not turn two-factor off. Admin set-password does not either.

### Admin

- `POST /api/v1/admin/users/{username}/mfa-resets` and `php artisan wgw:mfa:reset {username}` delete the secret and recovery codes and call `revokeAll()`. The admin user list gains `mfaEnabled`.
- The CLI command is the recovery path for the only admin on an install.

### Contract

- OpenAPI first, then `pnpm check:api-types`. New routes are added to the role-access matrix. New tables are added to `WgwSchemaParityTest` and `WgwSchemaMigratorTest`. Migrations take the next free number after `000950`.

## Edge cases

- Phone clock off by more than 30 seconds: code refused. The setup dialog and the sign-in step say to check the phone's time.
- Recovery codes all used and phone lost: only an admin reset or the CLI helps. The settings pane shows how many codes are left.
- A DAV client still sending the account password after the user turns two-factor on gets 401 on its next request. The setup flow lists when a DAV or Meet client last used the account password (`users.dav_password_used_at`) and asks the user to create an app password first.
- Two tabs on the login screen, each with its own challenge: verifying one leaves the other valid until it expires; both produce separate sessions.
- A challenge id guessed or reused after `consumed_at`: 404, and it counts as a failure on the IP limit only (there is no user to count against).
- User disabled or deleted between password and code: the challenge is refused with the same 401 as bad credentials.
- A recovery code typed with spaces or dashes, or a code pasted as `123 456`: separators are stripped before comparison.
- An undecryptable `totp_secret` (changed `APP_KEY`): sign-in for that user fails closed with a clear server log line; the admin reset still works because it does not read the secret.
- Offline: nothing changes. The outbox never signs in, and refresh never asks for a code, so the per-app outbox edits in #984 (which handled a removed "setup required" error) are not ported.
- Installs upgrading from a version without these tables: every existing user has no `user_mfa` row and signs in exactly as before.
