# MCP verification server

Callable verification tools for AI agents. Wraps existing repo scripts — MCP is a thin transport layer, not a second source of truth.

## Setup

The server is built from `tools/mcp-server/` (`@wgw/mcp-server`). After `pnpm install`, build once:

```bash
pnpm --filter @wgw/mcp-server build
```

### IDE configuration

| IDE | Config file | Status |
|-----|-------------|--------|
| **Cursor** | [`.cursor/mcp.json`](../../../.cursor/mcp.json) | Committed in repo |
| **Claude Code** | [`.mcp.json`](../../../.mcp.json) (repo root) | Committed in repo — keep in sync with Cursor variant |
| **VS Code Copilot** | `.vscode/mcp.json` | Copy the same `mcpServers` block locally if needed |

Shared server entry:

```json
{
  "mcpServers": {
    "wgw-verify": {
      "command": "node",
      "args": ["tools/mcp-server/dist/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**Claude Code caveat:** Claude Code ignores the `cwd` field in `.mcp.json` ([anthropics/claude-code-action#17565](https://github.com/anthropics/claude-code-action/issues/17565)). The server self-locates the repo root from its own install path (`import.meta.url` → `tools/mcp-server/dist/`) and runs `git rev-parse` with that explicit `cwd`, so verification works regardless of the process working directory.

### First-time onboarding

After pulling a branch that adds the MCP server, Cursor and Claude Code typically prompt for **explicit approval** to run the project MCP server (`wgw-verify`). Accept once per IDE/project — this is expected security behavior, not a misconfiguration.

Rebuild `dist/` after changing server source (`pnpm --filter @wgw/mcp-server build`).

## Tools

| Tool | Command | Timeout | When |
|------|---------|---------|------|
| `run_apps_done_gate` | `pnpm test:apps-done-gate` | 15 min | UI handoff / before push |
| `run_api_done_gate` | `pnpm test:api-done-gate` | 15 min | API handoff |
| `run_ci_quality` | `pnpm run ci:quality` | 30 min | Pre-PR full stack |
| `run_lint` | `pnpm lint` | 5 min | Quick check |
| `run_typecheck` | `pnpm typecheck` | 5 min | Quick check |
| `run_format_check` | `pnpm format:check` | 5 min | Quick check |
| `get_verification_context` | Reads policy + smells + done-checklist | — | Review/handoff context |

All `run_*` tools accept optional `tailLines` (default **200**) for longer done-gate output.

## Tool result format

Each `run_*` tool returns JSON:

```json
{
  "exitCode": 0,
  "status": "passed",
  "summary": "APPS DONE GATE: PASSED",
  "output": "…last N lines of combined stdout/stderr…"
}
```

- `status`: `passed` | `failed` | `timed_out`
- `exitCode`: `0` when passed; `-1` on timeout
- `output`: combined stdout/stderr, capped at **512 KB** before tail trim; prefix `[…truncated, showing last N lines…]` when trimmed

Spawn uses `stdio: ['ignore', 'pipe', 'pipe']` — output is captured and returned to the agent, not written to the MCP server terminal.

Repo root is derived from the server module location (`tools/mcp-server/dist/` → three levels up), then confirmed via `git rev-parse --show-toplevel` with that path as `cwd` (works from worktrees and when the IDE ignores `cwd`).

## When to use MCP vs bash

**Prefer MCP** before handoff:

- `run_apps_done_gate` / `run_api_done_gate` instead of raw `pnpm test:*-done-gate`
- `run_ci_quality` before opening a PR
- `get_verification_context` at review/handoff time

**Bash fallback** when MCP is unavailable (no IDE config, CI agent, or server not built).

## Related

- [done-checklist.md](done-checklist.md) — full handoff checklist
- [POLICY.md](../../POLICY.md) — policy vs enforcement
- [testing/apps-done-gate.md](../testing/apps-done-gate.md) — apps gate details
