# Agent Skills (WeGotWorkspace)

Tool-agnostic agent skills following the [Agent Skills](https://agentskills.io/specification) open standard. Compatible with Cursor, Claude Code, Codex, Copilot, and other skills-aware agents.

## Naming

Skill directories use **unprefixed names** (e.g. `api`, `developer`, `storybook`) — never `wgw-` prefixes. Product terms like `wgw` DB connection or `@wgw/openapi-types` in code are unrelated.

## Skills index

| Skill | Purpose |
|-------|---------|
| [developer](skills/developer/) | Monorepo entry point — dev layout, skill routing, multitask |
| [dev-environment](skills/dev-environment/) | Docker, ports, Storybook proxy, troubleshooting |
| [api](skills/api/) | Greenfield Laravel API — OpenAPI, layers, auth, storage, SabreDAV |
| [plugins](skills/plugins/) | Plugin registry, activation, install, Flysystem boundaries |
| [meet](skills/meet/) | Meet UI, RTC, room signaling |
| [apps-ui](skills/apps-ui/) | UI primitives, CSS variables, components, TypeScript |
| [workspace](skills/workspace/) | Workspace shell, *App/*Workspace blueprint |
| [plan-feature](skills/plan-feature/) | Feature planning and parallel chunk templates |
| [testing](skills/testing/) | PHPUnit, Vitest, e2e, done-when checklists |
| [document](skills/document/) | When/where to write docs; templates |
| [clean-code](skills/clean-code/) | Review checklist — smells.md before handoff |
| [code-review](skills/code-review/) | PR/handoff gate — smells, done-checklist, policy |
| [storybook](skills/storybook/) | Offline-first catalog, mock vs live, coverage, cssprops, a11y |
| [accessibility](skills/accessibility/) | WCAG 2.x compliance |
| [git-workflow](skills/git-workflow/) | Branching, commits, PRs, signed commits, CI gates |

## Usage

Agents discover skills by `name` and `description` at startup, then load full `SKILL.md` instructions when a task matches. Path-scoped skills (`paths` frontmatter) activate when editing matching files.

Depth lives in sibling `.md` files (e.g. `api/layers.md`, `storybook/offline-first.md`) — load on demand.

**Policy vs enforcement:** [.agents/POLICY.md](POLICY.md). **Done verification:** [developer/done-checklist.md](skills/developer/done-checklist.md).

For repo-wide bootstrap and non-negotiable constraints, see [AGENTS.md](../AGENTS.md) at the repository root.
