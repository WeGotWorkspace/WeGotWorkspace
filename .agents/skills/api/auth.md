# API auth

## Wire contract (parity)

- RS256 bearer + refresh rotation; same JSON keys as OpenAPI `AuthTokenResponse`
- The refresh token is cookie-borne (`wgw_refresh`, HttpOnly, path `<webBase>/api/v1/auth`). It is not in the JSON body and is not accepted from the request body.
- Endpoints: `auth/token`, `auth/session`, `auth/refresh`, `auth/revoke`, `me`, `/.well-known/jwks.json`

## Implementation (greenfield)

- Auth logic in injectable services + Eloquent/`users` + `principals` — not static `ApiAuth` + `\PDO`
- Rate-limit login in service layer
- Roles: `guest` | `user` | `admin`

## Do not

- Reintroduce `WgwRuntime` to populate `$_SERVER` for auth
- Copy `ApiAuth` / `ApiRevocationStore` verbatim without Laravel wiring
