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
