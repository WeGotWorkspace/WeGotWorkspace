Source: #717 (body-hash: d49b14ba)
Goal: #462

# MCP app CRUD with per-app read/write scopes

Technical translation of [#717](https://github.com/WeGotWorkspace/wegotworkspace/issues/717). Assistants already connect via remote `/mcp` (PR #715). This delivery splits OAuth into per-app `*.read` / `*.write` and adds curated CRUD tools that wrap existing domain services.

## Goal

Least-privilege MCP: each suite app (Calendar, Notes, Contacts, Tasks, Docs, Drive, Meet) has separate read and write OAuth scopes. Query tools take `*.read` (or the matching legacy alias). Write and share tools take `*.write` (or the same alias). Tools call the same create/update/share paths the browser apps use, with ACL still enforced in those services.

## Non-goals

- Mail, Admin, or Settings as MCP apps (keep `whoami` / `settings` / `mail_*`)
- Meet signaling / join / RTC
- 1:1 OpenAPI or raw JMAP batch; `icsProps` / unknown vendor fields
- Docs Yjs (`GET|PUT /files/collaboration`)
- Binary Drive upload; guest share-session exchange
- Calendar scheduling inbox and ICS import as MCP tools
- Recurrence instance overrides in the first calendar write slice
- Per-operation OAuth scopes (`events.delete`, …)
- Closing Goal #462

## Affected packages

- `packages/api` — `McpScopes`, `WgwMcpTool`, catalog, Blade consent, AS metadata, new MCP tools
- `packages/apps` — Settings connected-assistants grant labels when they list scope ids
- `docs/mcp-connect.md` — operator-facing scope and tool list (after tools land)

## Technical constraints

- Work on the MCP branch worktree (`cursor/mcp-assistant-access-0a47` or a follow-up `feat/` from it), rebased onto `origin/main` so Calendar Meet channel vs ad-hoc href helpers are present.
- **Advertised scopes:** `calendar|notes|contacts|tasks|docs|drive|meet` × `.read`/`.write`, plus `mail.read`, `mail.send`, `settings`, `offline_access` (kept in `scopes_supported` for MCP clients; not a consent toggle; refresh tokens are always issued).
- **Legacy aliases** (existing grants): bare `calendar|drive|tasks|contacts` = read+write for that app; bare `docs` = docs **and** notes read+write. `docs.read` does not grant Notes. Read does not imply write.
- Helper on `WgwMcpTool` (via `McpScopes`) replaces a single `tokenCan($scope)` check.
- Search is `*.read`, not a third OAuth id. Share CRUD uses `*.write` (no `*.share`).
- `capabilities` lists MCP tool **names** (`calendar_list`), not PHP class names.
- Consent Blade groups each app as Read / Write with honest copy (no “manage”).
- Register new tools in `McpToolCatalog` behind the same `WgwSettings` / `MAIL_ENABLED` gates. Do not call `User::createToken`; tests mint JWTs via `mcpBearerToken`.
- Write tools must pass through the fields the domain `create`/`update` already persists (not title-only toys). Size caps stay on the order of `drive_read` (~64KB).
- Dual-scope Meet convenience: `meet_create_scheduled` needs `calendar.write` for the event half; if missing, create the meeting-kind channel only and return the href.

## Edge cases

- Token with only `calendar.read` can list/query events, cannot write.
- Token with legacy `calendar` can both read and write.
- Token with `docs.read` cannot call `notes_search`; token with bare `docs` can.
- FilterMcpConsentScopes still drops unknown scopes; new ids survive.
- No SPA JWT on `/mcp`.
- Owner create/rename/delete of address books stays 403 — no MCP create-addressbook.
