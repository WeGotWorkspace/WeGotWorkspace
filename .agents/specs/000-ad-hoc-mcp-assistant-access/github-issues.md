# Paste-ready GitHub issues (Goal #462)

`gh` in this environment is read-only. File these in English with the Epic/Task templates. Do **not** add them to the Product Project. Suggested milestone: `v0.9` (packing only — Goal #462 Status stays Adopted).

Note for maintainers: Goal #462 still carries milestone v0.9 even though `v0.9-sprint-plan.md` deferred it. This filing does not change Goal Status.

---

## Epic

**Title:** `[Epic] MCP assistant access — OAuth AS + /mcp server`

**Labels:** `type:epic`, `area:platform`

### Parent goal

#462 — Use my existing AI assistant across the suite

### Scope

Remote Streamable HTTP MCP at `/mcp` inside `packages/api` (`laravel/mcp`), Passport OAuth 2.1 AS with DCR and a custom CIMD resolver, per-domain OAuth scopes, Blade consent with credential re-entry, Settings revoke UI, admin instance kill-switch, and MCP audit logging. Tools call existing domain services as the signed-in user.

### Slices

- [ ] Front-door carve-out: `/mcp`, `/oauth/*`, and both `.well-known` OAuth paths never fall through to SabreDAV; origin-root discovery documented for supported topologies
- [ ] Authenticatable `User` adapter (Sabre digest via `SabreCredentialValidator`; no second user table; SPA JWT unchanged)
- [ ] Passport AS + laravel/mcp: PRM, AS metadata, PKCE-only authorization code, DCR (throttled + GC), token lifetimes (~1h access, ~30d rotating refresh), `offline_access` gates refresh tokens, audience isolation from SPA JWT
- [ ] CIMD resolver: HTTPS fetch with DNS-rebinding protection, zero redirects, size/time caps, per-origin throttle, loopback IP literals only
- [ ] Scope catalog: `drive`, `docs`, `calendar`, `tasks`, `mail.read`, `mail.send`, `contacts`, `settings`, `offline_access`
- [ ] Blade consent (client origin as identity, CSRF-protected approve, LoginRateLimiter) + OpenAPI list/revoke + Settings "Connected assistants" pane
- [ ] `Mcp::web('/mcp')` Streamable HTTP, DB-backed MCP session store on `wgw`, 401 + WWW-Authenticate → PRM; Passport tokens only
- [ ] Curated tool registry with per-domain providers; each tool checks OAuth scope AND resource ACL; refusal hook for Admin, Installer, raw JMAP batch, E2EE vault plaintext
- [ ] `mcp_enabled` AppSetting (default off) checked on every MCP/OAuth request; disable revokes all MCP tokens; admin-core toggle + human disabled page
- [ ] `mcp_audit_events` at tool boundary and OAuth lifecycle (grant created/revoked, kill-switch toggles); no message/file bodies
- [ ] Non-developer connect guide for Claude, ChatGPT, and Mistral

### Out of scope

- In-app AI (#392)
- Instance SSO (#395)
- Hosting models; custom GPTs / ChatGPT Actions as the primary path
- Guest MCP; local stdio transport
- Per-domain admin content policy beyond the kill-switch
- Admin viewer / retention for the audit log
- Closing Goal #462 (product judges Fulfilled)

### Done when

- A signed-in user can complete OAuth (CIMD and DCR) and call curated tools on `/mcp` as themselves
- The assistant cannot exceed the user (scope + ACL + refusal hook)
- The instance owner can turn MCP off (effective immediately, including existing grants)
- A user can revoke a single assistant (access + refresh invalidated)
- A non-developer can follow the connect guide for at least one popular assistant

---

## Tasks

Parent each task on the Epic above. Labels: `type:task`, `area:platform`.

### 1. `[Task] Carve MCP and OAuth paths out of the WebDAV front door`

**Acceptance criteria**

- [ ] `routes/web.php` catch-all excludes `/mcp`, `/oauth/*`, `/.well-known/oauth-authorization-server`, and `/.well-known/oauth-protected-resource` (and path-suffix PRM when a web base exists)
- [ ] `/mcp` is not on `UiStaticServer::spaRoutePrefixes()`
- [ ] Feature test: PROPFIND/GET to `/mcp` and the `.well-known` OAuth paths do not return SabreDAV bodies
- [ ] Supported deployment topologies (including Apache `Alias /api`) are documented so origin-root discovery reaches Laravel

**Non-goals:** Implementing OAuth or MCP handlers (stubs/404 from Laravel are enough).

### 2. `[Task] Authenticatable User adapter for Sabre digest users`

**Acceptance criteria**

- [ ] `App\Models\User` implements `Authenticatable` while remaining `final` with the existing `users` schema
- [ ] A custom user provider validates passwords via `SabreCredentialValidator`
- [ ] SPA JWT issue/validate/revoke tests still pass; no second user table

**Non-goals:** Passport install, changing digest storage.

### 3. `[Task] Passport AS, DCR, scopes, and token isolation`

**Acceptance criteria**

- [ ] `laravel/passport` + `laravel/mcp` install and boot with the PHP 8.5 PDO patch
- [ ] `oauth_*` tables on the `wgw` connection; keys via install/update
- [ ] PRM (RFC 9728) and AS metadata (RFC 8414) advertised; PKCE S256 required; `token_endpoint_auth_methods_supported` includes `none`
- [ ] DCR (RFC 7591) works; registration is throttled; unused/ephemeral clients are GC'd
- [ ] Scopes: `drive`, `docs`, `calendar`, `tasks`, `mail.read`, `mail.send`, `contacts`, `settings`, `offline_access`
- [ ] Access tokens ~1h; refresh ~30d rotating; refresh issued only when `offline_access` was granted
- [ ] Passport tokens are rejected on `/api/v1/*`; SPA JWTs are rejected on `/mcp`

**Non-goals:** CIMD resolver (next task); consent UI copy polish.

### 4. `[Task] CIMD resolver for URL client_id values`

**Acceptance criteria**

- [ ] HTTPS `client_id` URLs are fetched, validated, and materialized as ephemeral Passport clients with a revalidation TTL
- [ ] Fetch: zero redirects, `application/json`, ~64KB / ~5s caps, DNS-rebinding protection with IP pinning, per-origin throttle
- [ ] `redirect_uris`: https, or `http://127.0.0.1:{port}` / `http://[::1]:{port}` only (not `localhost` hostname)
- [ ] `token_endpoint_auth_methods` other than `none` are rejected
- [ ] Tests cover private-IP rejection and loopback-hostname rejection

**Non-goals:** DCR (already in Passport/laravel/mcp).

### 5. `[Task] Consent, grant list/revoke, and connected-assistants Settings pane`

**Acceptance criteria**

- [ ] Blade consent requires username + password (Decision A — no `sabre_ui_auth` reuse)
- [ ] Consent shows client **origin** as primary identity; self-asserted name is secondary
- [ ] Approve/deny and login POSTs are CSRF-protected (signed intent token and/or Origin check); `/mcp` and WebDAV still work without CSRF tokens
- [ ] Consent login uses `LoginRateLimiter`; deny returns an OAuth error redirect
- [ ] Consent copy states mailbox/drive content leaves the instance for the vendor's model
- [ ] Re-consent is skipped only when an active grant already covers all requested scopes
- [ ] OpenAPI + REST: list grants (name, origin, connected-at, scopes, last-used) and revoke (invalidates access + refresh immediately)
- [ ] Settings pane "Connected assistants" with confirm-on-revoke and empty state linking to the connect guide (Storybook + Vitest)

**Non-goals:** Admin force-revoke of another user's grant.

### 6. `[Task] MCP Streamable HTTP transport, kill-switch, tools, and audit`

**Acceptance criteria**

- [ ] `Mcp::web('/mcp')` Streamable HTTP with DB-backed session store on `wgw`
- [ ] Unauthenticated `/mcp` returns 401 + `WWW-Authenticate` pointing at PRM
- [ ] Body size capped (existing oversized-post pattern)
- [ ] `SettingKeys::MCP_ENABLED` default **off**; middleware on every OAuth + `/mcp` request
- [ ] Turning the switch off revokes all MCP tokens/grants; authorize shows a human disabled page; `/mcp` returns a JSON-RPC error
- [ ] Admin-core toggle for the kill-switch
- [ ] Curated tools (drive/docs/calendar/tasks/mail/contacts/settings + whoami) with scope + ACL checks; Admin/Installer/JMAP batch/vault plaintext refused
- [ ] Domain tools hidden when the domain is off instance-wide
- [ ] `mcp_audit_events` logs tool calls (no bodies) and OAuth lifecycle (grant created/revoked, kill-switch toggles)

**Non-goals:** Admin audit viewer; local stdio; 1:1 OpenAPI dump.

### 7. `[Task] Connect guide and verification`

**Acceptance criteria**

- [ ] Non-developer guide covering Claude, ChatGPT, and Mistral (public HTTPS / tunnel note; sign in again on the instance)
- [ ] Epic AC verified; Goal #462 is **not** closed

**Non-goals:** Product Fulfilled judgment on #462.
