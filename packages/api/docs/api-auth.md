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
- `token_type` (`Bearer`)
- `expires_in`
- `refresh_expires_in`
- `role`
- `username`

The refresh token is not in the JSON body. The response sets an `HttpOnly` `wgw_refresh` cookie (`SameSite=Strict`, path `<webBase>/api/v1/auth`, `Secure` when the request is HTTPS, `Max-Age` = `WGW_API_JWT_REFRESH_TTL`).

Every answer has `status`. `ok` is the token answer above. With two-factor on, a correct password answers `status: mfa_required` instead, with no tokens and no cookie (see [Two-factor sign-in](#two-factor-sign-in)).

## 3) Use the token

```bash
TOKEN="PASTE_ACCESS_TOKEN"
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k "${BASE_URL}/api/v1/me" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "accept: application/json"
```

## 4) Refresh and revoke

The refresh token travels only in the `wgw_refresh` cookie. Save it on token issuance and send the jar back.

Refresh:

```bash
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k -c jar.txt -X POST "${BASE_URL}/api/v1/auth/token" \
  -H "Content-Type: application/json" \
  --data '{"username":"admin","password":"YOUR_PASSWORD"}'
curl -k -b jar.txt -c jar.txt -X POST "${BASE_URL}/api/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  --data '{}'
```

Revoke the current access token and the refresh cookie:

```bash
BASE_URL="${BASE_URL:-https://${VHOST_DOMAIN:-localhost}:8443}"
curl -k -b jar.txt -c jar.txt -X POST "${BASE_URL}/api/v1/auth/revoke" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{}'
```

## 5) Verify via JWKS

Public keys are exposed at:

```text
/api/v1/.well-known/jwks.json
```

## Two-factor sign-in

Users can turn on an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 seconds) in Settings (#2273). With it on, the password alone signs in nowhere.

### Web sign-in (`client: spa`)

1. `POST /api/v1/auth/token` with the password answers:

   ```json
   { "status": "mfa_required", "challenge": "<64 hex>", "client": "spa" }
   ```

2. `POST /api/v1/auth/mfa-challenges/{challenge}/verification` with exactly one of `{ "code": "123456" }` or `{ "recovery_code": "1a2b-3c4d-5e6f-7a8b" }`:
   - a right code: the token answer of step 2 above (`status: ok`, refresh cookie set);
   - a right recovery code: it is spent, and the answer asks for a new authenticator, still without tokens:

     ```json
     { "status": "mfa_replace_required", "challenge": "<64 hex>", "client": "spa",
       "secret": "<base32>", "otpauth_uri": "otpauth://totp/…" }
     ```

3. After a recovery code: `POST /api/v1/auth/mfa-challenges/{challenge}/replacement` with `{ "code": "<code from the new secret>" }`. In one transaction it stores the new secret, makes ten new recovery codes and ends every session of the user (`UserSessionRevoker::revokeAll()`), then answers the token answer plus `recovery_codes`. If the user walks away instead, the old authenticator stays live and the recovery code stays spent.

```bash
curl -k -c jar.txt -X POST "${BASE_URL}/api/v1/auth/token" \
  -H "Content-Type: application/json" \
  --data '{"username":"admin","password":"YOUR_PASSWORD"}'
# → {"status":"mfa_required","challenge":"CHALLENGE","client":"spa"}
curl -k -c jar.txt -X POST "${BASE_URL}/api/v1/auth/mfa-challenges/CHALLENGE/verification" \
  -H "Content-Type: application/json" \
  --data '{"code":"123456"}'
```

### Assistant sign-in (`client: oauth`)

`POST /oauth/session` takes both steps, JSON only, each post with the same `intent`:

1. `{ username, password, intent }` → `{ status: "mfa_required", challenge, client: "oauth" }`. No web session yet, no session id change.
2. `{ challenge, code, intent }` → `{ ok: true, status: "ok", redirect }`, and the web session starts; or `{ challenge, recovery_code, intent }` → `mfa_replace_required` as above.
3. After a recovery code: `{ challenge, code, intent }` with a code from the new secret → `{ ok: true, status: "ok", redirect, recovery_codes }`.

A form post (not JSON) for a user with two-factor on does not sign in; it goes back to the login page.

### Rules

| Rule | Answer |
|---|---|
| Unknown, expired (10 min), used, or other-client challenge | 404 `not_found`; an `spa` challenge never completes on `/oauth/session` and the other way round |
| Wrong code or recovery code | 401 `mfa_code_invalid` (403 on the settings routes) |
| Same code twice, or an older one | refused: `user_mfa.last_used_step` only moves forward; one step of clock drift either way is accepted |
| 5 tries on one challenge | the challenge is gone (404); each try is counted before the code is read |
| 10 wrong codes for one user within an hour, across challenges and settings | locked for an hour from the tenth: 429 `throttled` with `Retry-After`, even for the right code; open challenges are deleted |
| Sign-in limits | every code also counts on the web sign-in limiter of user and address; unknown challenge ids count on the address |
| Disabled user | 401 `unauthorized` |
| Secret no longer decrypts (APP_KEY changed) | 503 `mfa_unavailable` and a `mfa_secret_unreadable` log line; reset the user |

### Calendar, contacts, files and Meet apps

With two-factor on, DAV Basic and Meet Basic refuse the account password, before the verified-password memory is read, so a password remembered from before does not work either. Those apps use app passwords (`/api/v1/settings/app-passwords`); `users.dav_password_used_at`, shown when setup starts, tells the user which apps still use the account password.

### Settings

| Route | Body | Answer |
|---|---|---|
| `POST /api/v1/settings/totp` | `currentPassword` | `{ secret, otpauth_uri, davPasswordUsedAt }`; 409 `mfa_already_enabled` while on (never the live secret) |
| `POST /api/v1/settings/totp/confirmation` | `currentPassword`, `code` | `{ recovery_codes }`, two-factor on, every session ended; 400 `mfa_setup_missing` without a start |
| `DELETE /api/v1/settings/totp` | `code` | `{ ok: true }`, two-factor off; 409 `mfa_not_enabled` |
| `POST /api/v1/settings/totp/recovery-codes` | `code` | ten new `recovery_codes`; the old set stops working |

`GET /api/v1/me` and `GET /api/v1/settings/state` carry `mfa: { enabled, recoveryCodesRemaining }`; the admin user list carries `mfaEnabled`.

### Reset (lost phone)

An admin: `POST /api/v1/admin/users/{username}/mfa-resets`. On the server:

```bash
php artisan wgw:mfa:reset USERNAME
```

Both delete the authenticator, the recovery codes and open challenges without reading the secret (so they work after an APP_KEY change), then end every session. The user signs in with the password and can set up two-factor again.
