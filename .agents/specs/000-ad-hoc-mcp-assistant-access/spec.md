Source: ad-hoc
Goal: #462

# MCP assistant access (OAuth AS + /mcp)

Technical translation of Goal #462 delivery. Re-home `Source:` to the Epic number and body-hash when the Epic is filed. Do not use #462 as `Source:`.

## Goal

Claude, ChatGPT, Mistral, and other MCP clients connect to a self-hosted instance over public HTTPS Streamable HTTP at `/mcp`. The assistant acts as the signed-in user via a Passport OAuth 2.1 authorization server (DCR + CIMD). Tools call existing domain services. An admin kill-switch (default off), per-user revoke, and MCP audit log are part of Goal-complete.

## Non-goals

- In-app AI (#392), instance SSO (#395), hosting models
- Guest MCP, local stdio, 1:1 OpenAPI dump
- Admin audit viewer / retention
- SPA JWT accepted on `/mcp`

## Affected packages

- `packages/api` — OAuth, MCP, OpenAPI grant list/revoke, migrations
- `packages/apps` — Settings connected-assistants pane; admin kill-switch toggle
- `docs/` — connect guide and discovery topology notes

## Technical constraints

- `User` stays `final` Sabre digest; Authenticatable via contract + custom provider
- `oauth_*`, `mcp_sessions`, and `mcp_audit_events` on the `wgw` connection (`WgwMigration`)
- CSRF remains disabled for WebDAV/`/mcp`; consent POSTs use a signed intent token + Origin check
- Consent login is Decision A: always re-enter credentials
- Scopes: `drive`, `docs`, `calendar`, `tasks`, `mail.read`, `mail.send`, `contacts`, `settings`, `offline_access`
- Two locks per tool: OAuth scope and existing resource ACL
- Hard refuse: Admin, Installer, raw JMAP batch, E2EE vault plaintext (#391)
- `mcp_enabled` default false; disable revokes all MCP grants

## Edge cases

- CIMD `client_name` is attacker-chosen — display origin as identity
- Loopback redirects: IP literals only, variable port
- DNS rebinding on CIMD fetch (including TTL revalidation)
- Kill-switch off: discovery, authorize, DCR/CIMD, token, and `/mcp` all refuse
- Re-enable after disable must not resurrect revoked grants
