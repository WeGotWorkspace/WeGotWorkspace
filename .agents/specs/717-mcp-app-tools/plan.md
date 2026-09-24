# MCP app CRUD with per-app read/write scopes

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `mcp_app_crud_scopes_1120e903`.

## Goal

Per-app `*.read` / `*.write` OAuth, then curated MCP CRUD for Calendar, Drive, Tasks, Notes, Contacts, Docs, and Meet. Mail/Admin/Settings stay out of MCP as apps.

## Non-goals

- Mail, Admin, Settings as MCP apps
- Meet join / RTC / signaling tools
- Yjs Docs; binary Drive upload; calendar inbox/ICS import; recurrence overrides
- Closing Goal #462

## Affected packages

- packages/api | packages/apps (grant labels) | docs

## Dependencies

1. **setup** first — Task #717 under Goal #462; spec files; MCP worktree rebased onto `origin/main`.
2. **scopes (A)** before every domain chunk — new ids, aliases, consent grouping, retarget existing tools.
3. **calendar (B)** after A (unblocks events + Meet attach). Drive (C) and Tasks (D) after A; may run in parallel after A if catalog edits are serialized.
4. **notes (E)** after A; Contacts (F) after E (or with E if different files).
5. **docs (G)** after Drive write/share (C).
6. **meet (I)** after A; after B if testing dual-scope `meet_create_scheduled`.
7. **docs-connect (H)** after B at least; refresh at end.
8. **verify (V)** after domain chunks merge.

## Chunks

### Chunk 0: Spec + Task

- **id:** `setup`
- **Skill:** plan-feature / issue-filing / git-workflow
- **Inputs:** Goal #462; Cursor plan `mcp_app_crud_scopes_1120e903`
- **Done when:** Task under #462; spec files; MCP worktree rebased onto `main` (Meet channel calendar links)
- **Verify with:** `gh issue view 717` parent is #462; spec header body-hash; `git merge-base HEAD origin/main` equals `origin/main`
- **Parallel with:** none

### Chunk A: Scopes first

- **id:** `chunk-a-scopes`
- **Skill:** api
- **Inputs:** `McpScopes.php`, `WgwMcpTool.php`, `resources/views/mcp/authorize.blade.php`, OpenAPI mcp-grants if it lists scope ids
- **Done when:** New scopes advertised; legacy aliases; existing tools require `*.read` (`notes_search` → `notes.read`); consent grouped Read/Write; PHPUnit for alias + denial of write without `*.write`; `capabilities` lists MCP names
- **Verify with:** `phpunit tests/Feature/Mcp/` (and unit tests added)
- **Parallel with:** none

### Chunk B: Calendar

- **id:** `chunk-b-calendar`
- **Skill:** api
- **Inputs:** `CalendarEventRepository`, `CalendarMeetLinkHref`, catalog
- **Done when:** events query/write (RRULE, `description`, participants, Meet from existing `#channel` or new `/meet/meetings/{code}`, iMIP); calendar write; calendar share; PHPUnit
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** none (after A)

### Chunk C: Drive

- **id:** `chunk-c-drive`
- **Skill:** api
- **Inputs:** `DriveService`, `DriveShareService`
- **Done when:** `drive_write` + `drive_share`; text write helper + ACL tests
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** D (after A; serialize catalog edits)

### Chunk D: Tasks

- **id:** `chunk-d-tasks`
- **Skill:** api
- **Inputs:** `TaskRepository`, `TaskListRepository`
- **Done when:** tasklist write/share + `task_write` create/update/delete with `taskListId`, `due`, `workflowStatus`, `priority`, `alerts`; PHPUnit
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** C or E

### Chunk E: Notes

- **id:** `chunk-e-notes`
- **Skill:** api
- **Inputs:** Notes REST / repositories
- **Done when:** notebooks CRUD + share; `note_write` with `notebookId`, `title`, `body`, `categories`; `notes_search` notes-only
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** D

### Chunk F: Contacts

- **id:** `chunk-f-contacts`
- **Skill:** api
- **Inputs:** `ContactCardRepository`
- **Done when:** addressbook list/get + shareWith; `contact_write` with common JSContact fields; no owner create-addressbook tool
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** none (after E, or with E if different files)

### Chunk G: Docs

- **id:** `chunk-g-docs`
- **Skill:** api
- **Inputs:** Drive/FileNode helpers, `DriveShareService`
- **Done when:** docs search/read/write/share on Drive doc paths (text, not Yjs)
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** none (after C)

### Chunk I: Meet

- **id:** `chunk-i-meet`
- **Skill:** api
- **Inputs:** Chat REST
- **Done when:** channel CRUD (`channel` + `meeting`); message list/send/edit/delete; `meet_create_scheduled` requires `calendar.write` for the event half; no join/RTC tools
- **Verify with:** `phpunit tests/Feature/Mcp/`
- **Parallel with:** none (after A; after B if testing dual-scope)

### Chunk H: Docs for operators

- **id:** `chunk-h-docs-connect`
- **Skill:** document
- **Inputs:** `docs/mcp-connect.md`
- **Done when:** Scope list and read vs write + tool names documented; Mail/Admin/Settings still out of MCP apps
- **Verify with:** `pnpm run check:agent-docs`
- **Parallel with:** none (after B at least; refresh at end)

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** verify-issue / testing
- **Done when:** verifier `PASS` or `PASS_WITH_NITS`; scope aliases, catalog vs kill-switch, ACL, no SPA JWT on `/mcp`; issue AC mapped
- **Verify with:** `gh issue view 717`; `phpunit tests/Feature/Mcp/`; `composer done-gate` before handoff
- **Parallel with:** none

## Test plan

- [ ] Token with only `calendar.read` can query tools, cannot write; legacy `calendar` can both
- [ ] Per write tool: happy path + missing scope + ACL deny
- [ ] FilterMcpConsentScopes drops unknown scopes; new ids survive
- [ ] `capabilities` returns MCP names
- [ ] `composer done-gate` / `pnpm test:api-done-gate` before handoff; apps gate only if consent/settings UI strings change
