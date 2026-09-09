# MCP assistant access

Derived from [spec.md](./spec.md). Sequential API core, then UI in parallel with tools.

## Goal

Ship `/mcp` + Passport OAuth (DCR + CIMD), curated tools, kill-switch, revoke, and audit for Goal #462.

## Non-goals

See spec.md.

## Affected packages

- packages/api
- packages/apps
- docs

## Dependencies

A (front door) and B (User adapter) first → C (Passport + laravel/mcp) → D (CIMD) and E (scopes with C) → I (kill-switch with C) → G (transport) → F (consent/UI) and H (tools) → J (audit) → K (docs).

## Chunks

### Chunk A: Front-door carve-out

- **id:** `front-door`
- **Skill:** api
- **Inputs:** `packages/api/routes/web.php`
- **Done when:** MCP/OAuth/well-known paths never hit SabreDAV
- **Verify with:** `phpunit tests/Feature/Front/FrontRoutingTest.php tests/Feature/Mcp/McpFrontDoorTest.php`
- **Parallel with:** `user-adapter`

### Chunk B: Authenticatable User

- **id:** `user-adapter`
- **Skill:** api
- **Inputs:** `app/Models/User.php`, `SabreCredentialValidator`
- **Done when:** Laravel guards can authenticate Sabre users; SPA JWT unchanged
- **Verify with:** `phpunit tests/Unit/Auth/SabreUserProviderTest.php`
- **Parallel with:** `front-door`

### Chunk C: Passport AS + DCR + scopes

- **id:** `oauth-as`
- **Skill:** api
- **Inputs:** composer deps, wgw migrations, auth config
- **Done when:** PRM/AS metadata, PKCE, DCR, scope catalog, token isolation, `offline_access` gates refresh
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** none (after B)

### Chunk D: CIMD resolver

- **id:** `cimd-resolver`
- **Skill:** api
- **Inputs:** authorize/token pipeline
- **Done when:** URL `client_id` materializes an ephemeral client under the hardening spec
- **Verify with:** `phpunit tests/Unit/Mcp/CimdResolverTest.php tests/Feature/Mcp/CimdAuthorizeTest.php`
- **Parallel with:** none (after C)

### Chunk E: Scope catalog

- **id:** `scope-catalog`
- **Skill:** api
- **Inputs:** Passport tokensCan / AS metadata
- **Done when:** Catalog is advertised before any token is issued
- **Verify with:** metadata feature test
- **Parallel with:** `oauth-as`

### Chunk F: Consent + revoke UI

- **id:** `consent-revoke`
- **Skill:** workspace
- **Inputs:** Passport authorize view, OpenAPI, settings-core, admin-core
- **Done when:** Blade consent (Decision A), REST list/revoke, Settings pane, admin toggle
- **Verify with:** API feature tests + `pnpm --dir packages/apps exec vitest run`
- **Parallel with:** `mcp-transport`, `tool-registry`

### Chunk G: MCP transport

- **id:** `mcp-transport`
- **Skill:** api
- **Inputs:** laravel/mcp
- **Done when:** Streamable HTTP at `/mcp`, DB sessions, 401+PRM, no JWT fallback
- **Verify with:** `phpunit tests/Feature/Mcp/McpTransportTest.php`
- **Parallel with:** `consent-revoke`

### Chunk H: Tool registry

- **id:** `tool-registry`
- **Skill:** api
- **Inputs:** domain services
- **Done when:** Curated tools + refusal hook + capability hiding
- **Verify with:** `phpunit tests/Feature/Mcp/McpToolsTest.php`
- **Parallel with:** `consent-revoke`

### Chunk I: Kill-switch

- **id:** `kill-switch`
- **Skill:** api
- **Inputs:** SettingKeys, middleware
- **Done when:** Default off; disable revokes tokens; checked on every MCP/OAuth request
- **Verify with:** `phpunit tests/Feature/Mcp/McpKillSwitchTest.php`
- **Parallel with:** `oauth-as`

### Chunk J: Audit log

- **id:** `audit-log`
- **Skill:** api
- **Inputs:** tool boundary + OAuth lifecycle
- **Done when:** Events persisted without bodies
- **Verify with:** `phpunit tests/Feature/Mcp/McpAuditTest.php`
- **Parallel with:** none (after H)

### Chunk K: Docs + verify

- **id:** `docs-verify`
- **Skill:** document
- **Inputs:** deploy topology + client quirks
- **Done when:** Connect guide exists; Epic AC mapped; #462 not closed
- **Verify with:** `pnpm run check:agent-docs`; verify-issue notes in PR
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI for grant list/revoke → feature tests → `composer done-gate`
- [ ] UI: mock-tier Storybook + Vitest; `pnpm test:apps-done-gate` before push
- [ ] Front door + CSRF regression: WebDAV and `/mcp` still work without CSRF tokens
