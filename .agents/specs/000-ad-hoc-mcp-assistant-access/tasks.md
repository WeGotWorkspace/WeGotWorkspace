# Engineering tasks — MCP assistant access

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `front-door` | builder | api | `packages/api/routes/web.php` | `phpunit tests/Feature/Mcp/McpFrontDoorTest.php` | pending |
| `user-adapter` | builder | api | `app/Models/User.php`, `app/Auth/SabreUserProvider.php` | `phpunit tests/Unit/Auth/SabreUserProviderTest.php` | pending |
| `oauth-as` | builder | api | Passport + laravel/mcp, `database/migrations/wgw/` | `phpunit tests/Feature/Mcp/` | pending |
| `cimd-resolver` | builder | api | `app/Services/Mcp/CimdResolver.php` | `phpunit tests/Unit/Mcp/CimdResolverTest.php` | pending |
| `scope-catalog` | builder | api | `app/Services/Mcp/McpScopes.php` | metadata feature test | pending |
| `consent-revoke` | builder | workspace | Blade views, settings-core, admin-core, OpenAPI | vitest + feature tests | pending |
| `mcp-transport` | builder | api | `routes/ai.php`, WorkspaceServer | `phpunit tests/Feature/Mcp/McpTransportTest.php` | pending |
| `tool-registry` | builder | api | `app/Mcp/` | `phpunit tests/Feature/Mcp/McpToolsTest.php` | pending |
| `kill-switch` | builder | api | SettingKeys, middleware, admin-core | `phpunit tests/Feature/Mcp/McpKillSwitchTest.php` | pending |
| `audit-log` | builder | api | `McpAuditLogger`, `mcp_audit_events` | `phpunit tests/Feature/Mcp/McpAuditTest.php` | pending |
| `docs-verify` | builder | document | `docs/mcp-connect.md` | `pnpm run check:agent-docs` | pending |
