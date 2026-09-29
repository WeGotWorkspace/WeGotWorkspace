# API Auth Quickstart

The `/api/v1` endpoints use bearer JWT tokens signed with RS256.

## 1) Signing keys

For Docker-free monorepo dev, run **`pnpm dev`** or **`pnpm preview`** — the first run bootstraps `packages/api/.env` (`WGW_*`), SQLite, an `admin` user, and RSA keys under `wgw-content/keys/` (no manual OpenSSL step). Default login: `admin` / `storybook-dev` (override with `WGW_DEV_USERNAME` / `WGW_DEV_PASSWORD`).

The web installer and `wgw:dev-install` create these files:

- `api-jwt-private.pem`
- `api-jwt-public.pem`

By default, the API reads them from your install data directory (typically `wgw-content/keys/`).

If keys are missing after an older install:

```bash
php packages/api/artisan wgw:jwt-keys
```

To re-run the full local bootstrap manually:

```bash
php packages/api/artisan wgw:dev-install
```

### Advanced: manual OpenSSL override

From the install root (`apps/wegotworkspace` in monorepo dev):

```bash
mkdir -p wgw-content/keys
openssl genrsa -out wgw-content/keys/api-jwt-private.pem 2048
openssl rsa -in wgw-content/keys/api-jwt-private.pem -pubout -out wgw-content/keys/api-jwt-public.pem
chmod 600 wgw-content/keys/api-jwt-private.pem
```

You can override paths or inline PEM with env/config constants:

- `WGW_API_JWT_PRIVATE_KEY` or `WGW_API_JWT_PRIVATE_KEY_PATH`
- `WGW_API_JWT_PUBLIC_KEY` or `WGW_API_JWT_PUBLIC_KEY_PATH`
- `WGW_API_JWT_ISSUER`, `WGW_API_JWT_AUDIENCE`, `WGW_API_JWT_KID`
- `WGW_API_JWT_ACCESS_TTL` (access token TTL in seconds, default `3600`)
- `WGW_API_JWT_REFRESH_TTL` (refresh token TTL in seconds, default `1209600`)
- Optional rollover:
  - `WGW_API_JWT_PREVIOUS_KID`
  - `WGW_API_JWT_PREVIOUS_PUBLIC_KEY` or `WGW_API_JWT_PREVIOUS_PUBLIC_KEY_PATH`

## 2) Request a token

```bash
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k -X POST "${BASE_URL}/api/v1/auth/token" \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "username": "admin",
  "password": "YOUR_PASSWORD"
}
JSON
```

Expected success fields:

- `access_token`
- `refresh_token`
- `token_type` (`Bearer`)
- `expires_in`
- `refresh_expires_in`
- `role`
- `username`

## 3) Use the token

```bash
TOKEN="PASTE_ACCESS_TOKEN"
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k "${BASE_URL}/api/v1/me" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "accept: application/json"
```

## 4) Refresh and revoke

Refresh:

```bash
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k -X POST "${BASE_URL}/api/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  --data '{"refresh_token":"PASTE_REFRESH_TOKEN"}'
```

Revoke current access token and optionally a refresh token:

```bash
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k -X POST "${BASE_URL}/api/v1/auth/revoke" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"refresh_token":"PASTE_REFRESH_TOKEN"}'
```

## 5) Verify via JWKS

Public keys are exposed at:

```text
/api/v1/.well-known/jwks.json
```

## 6) Two-factor authentication and app passwords

TOTP is opt-in. `POST /api/v1/auth/token` still returns `access_token` and `refresh_token` when the account has no authenticator. The body also includes `status`:

| `status` | Meaning |
| --- | --- |
| `ok` | Tokens are in the body. |
| `mfa_required` | Password matched. Send the authenticator `code` or a `recovery_code` to `POST /api/v1/auth/mfa-challenges/{challenge}/verification`. |
| `mfa_setup_required` | An admin requires two-factor authentication and this account has not enrolled. |
| `mfa_replace_required` | A recovery code was accepted. Confirm a new authenticator before any tokens are issued. |

Challenge bodies include `client`: `spa` for `POST /api/v1/auth/token`, or `oauth` for assistant login. An `oauth` challenge is finished on `POST /oauth/session` with `{challenge, code}` or `{challenge, recovery_code}` (and `{challenge, code, password}` when confirming setup). That request signs in the web session Passport needs. The API verification route refuses an `oauth` challenge.

A recovery code at login does not return tokens. It starts authenticator replacement. Confirming that replacement, or turning two-factor authentication on in Settings, signs out other sessions and returns a new token pair.

Turning two-factor authentication on requires the account password before the QR code is shown, and again when the authenticator code is confirmed. Sign-in that already accepted that password reuses it for a required setup challenge. A setup challenge cannot replace an authenticator that is already on.

Failed account-password checks on enrollment and app-password creation share the sign-in rate limit. A successful check clears that user-and-IP counter. The password is compared exactly, including spaces at either end.

Changing the account password revokes refresh tokens and bumps `session_generation`. `PUT /settings/profile` then returns a new token pair and `Set-Cookie` for the browser that changed it. Older access tokens and the previous `sabre_ui_auth` cookie stop working. An older refresh token is refused because its session generation no longer matches, and that refusal leaves the new refresh token in place. Reuse of a refresh token from the current generation still revokes the chain.

App passwords are named secrets for calendar and contact clients. Create and revoke them under Settings → Security. After two-factor authentication is on, DAV and Meet Basic reject the account password and accept an app password. Users who have not enrolled can still use the account password on DAV.

`GET /api/v1/me` includes `mfa.suggest` when the account has no authenticator and has not snoozed the prompt. `POST /api/v1/settings/totp/suggestion` snoozes that prompt for 30 days.

Lost the authenticator and the recovery codes? An admin can reset two-factor authentication for that user, or an operator can run:

```bash
php artisan wgw:mfa:reset {username}
php artisan wgw:mfa:enforce on
php artisan wgw:mfa:enforce off
```

The CLI commands do not ask for an authenticator code. The HTTP enforcement route does, and it refuses to turn the requirement on until that admin has enrolled.

Ten failed authenticator or recovery codes for one username, including codes sent as re-authentication on an existing session, lock that username for an hour. A correct code does not clear the lock. Each login challenge also stops after five failures, and a correct code after that cap is refused. The sign-in screen says "Lost access? Ask your admin." See [Two-factor authentication](../../../docs/two-factor-authentication.md).
