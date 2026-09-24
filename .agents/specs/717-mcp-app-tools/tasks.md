# Engineering tasks — MCP app CRUD with per-app read/write scopes

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `setup` | builder | developer, plan-feature | `.agents/specs/717-mcp-app-tools/` | `gh issue view 717`; parent #462; body-hash `d49b14ba`; merge-base = origin/main | done |
| `chunk-a-scopes` | builder | api | `McpScopes.php`, `WgwMcpTool.php`, `authorize.blade.php`, existing MCP tools, Settings grant fixtures | `phpunit tests/Feature/Mcp/ tests/Unit/Mcp/` | done |
| `chunk-b-calendar` | builder | api | Calendar MCP tools, `CalendarEventRepository`, Meet href helpers | `phpunit tests/Feature/Mcp/` | done |
| `chunk-c-drive` | builder | api | Drive write/share tools, `DriveService`, `DriveShareService` | `phpunit tests/Feature/Mcp/` | done |
| `chunk-d-tasks` | builder | api | Task list/write tools, `TaskRepository` | `phpunit tests/Feature/Mcp/` | done |
| `chunk-e-notes` | builder | api | Notebook/note write tools | `phpunit tests/Feature/Mcp/` | done |
| `chunk-f-contacts` | builder | api | Addressbook/contact write tools | `phpunit tests/Feature/Mcp/` | done |
| `chunk-g-docs` | builder | api | Docs search/read/write/share on Drive `.md` | `phpunit tests/Feature/Mcp/` | done |
| `chunk-i-meet` | builder | api | Meet channel/message tools | `phpunit tests/Feature/Mcp/` | done |
| `chunk-h-docs-connect` | builder | document | `docs/mcp-connect.md` | `pnpm run check:agent-docs` | done |
| `chunk-v-verify` | verifier | verify-issue | catalog vs scopes vs AC | `gh issue view 717`; done-gate | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Task #717** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Catalog file `McpToolCatalog.php` is the merge hotspot — serialize registration edits across C/D/E.
