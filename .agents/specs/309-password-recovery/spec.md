Source: #309 (body-hash: 9854908b)
Goal: #389

# Self-service password recovery

Technical translation of Task #309. Product context: Goal #389 (recover my password without an admin). Not a copy of the issue AC checklist.

## Goal

Give a self-hosted instance a guest forgot-password / reset-token path so a user can set a new password without an admin KeyRound, when platform mail can submit. Recovery looks up username or `principals.email`, stores a hashed one-time token on the `wgw` connection, and sends a plain-text link via `MailDeliveryService` (PR #475 / Task #473). Login offers the flow only when `GET /capabilities` reports `auth.passwordRecovery`.

## Non-goals

- SMTP / Mail-app sending or changing `MailDeliveryService` (Goal #471 / Task #473)
- Extra account-takeover controls (CAPTCHA, MFA, device signals)
- OIDC / social recovery (Goal #395)
- Auto-login after reset
- Installer wizard step
- Requiring email on every user at create time
- An extra admin “enable recovery” toggle (enablement is mail `canSubmit`)

## Affected packages

- `packages/api` — OpenAPI guest auth paths, `PasswordRecoveryService`, `wgw` token table, capabilities flag, feature tests
- `packages/apps` — `login-core` forgot/reset screens + stories, `/login/forgot` and `/login/reset`, Email delivery helper copy

## Technical constraints

- OpenAPI first; both operations `x-wgw-access: guest`. Register outside `wgw.auth` in `routes/api.php`.
- Do **not** use Laravel’s Password broker or the scaffold `password_reset_tokens` table (wrong connection; WGW `User` has no email). Follow `api_refresh_tokens`: `bin2hex(random_bytes(32))`, store `hash('sha256', $token)` only.
- Email is on `principals`, not `users`. Identifier matches `users.username` (lowercased) **or** `principals.email` (case-insensitive).
- Inject `App\Services\MailDelivery\MailDeliveryService` only. Build `OutboundMessage` with `from` from `loadConfig()->from`, `to` = principal email, plain `textBody` (no Mailable). `send()` failures stay `DeliveryResult` — still return generic 200 to the client.
- `canSubmit` is a preflight (`fromConfigured && transport canAttempt`), not inbox proof. Copy must not claim placement.
- Password write reuses the same ≥10 / `users.digest` rule as `UserProfileService::updatePassword`. On success, revoke that username’s refresh tokens. Do not issue a JWT.
- Rate-limit the request endpoint in the service layer (same family as `LoginRateLimiter`).
- SPA routes nest under `/login` so `UiStaticServer::shellRoutePrefixes()` and `AUTH_ROUTE_PREFIXES` already cover them. No new top-level prefix. Guest screens reuse `AuthenticationPage`.
- `GET /capabilities` `auth.passwordRecovery` = mail delivery `canSubmit`. Login hides “Forgot password?” when false (Storybook mock may always show).

## Edge cases

- Unknown identifier, user without principal email, or `canSubmit` false → same 200, no send
- New request for the same user replaces the previous token
- Expired or already-consumed token → 400, no user leak
- Delivery `accepted === false` after `send()` → still 200 to the client; log `DeliveryResult` for operators
- Invalid From / no recipients throws `InvalidOutboundMessageException` — treat as no-send, still generic 200
- Users without email keep Admin → Users KeyRound
- Missing inbox after `accepted_by_transport` is DNS/SPF/DKIM, not this task
