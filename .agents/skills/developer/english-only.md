# English-only artifacts

**Prompt language does not change output language.** User chat may be Dutch; every artifact below is **English**.

## Must be English

| Surface | Examples |
|---------|---------|
| **Plans and specs** | `.agents/specs/**` (`spec.md`, `plan.md`, `tasks.md`), `.agents/plans/**`, `docs/plans/**` |
| **Documentation** | `docs/**`, `packages/*/docs/**`, READMEs, `AGENTS.md`, skills, Cursor rules |
| **GitHub** | Issue titles and bodies (Goals, Epics, Tasks, Chores, Bugs), issue comments, PR titles/bodies, review comments, anything posted via `gh` or the GitHub API |
| **Commit messages** | Conventional Commits subject and body |

Do not file a Dutch Goal, Task, or comment and “translate later.” Write English in the first `gh issue create` / `gh issue comment` / spec commit.

## Out of scope

- **User chat** — reply in the user’s language; still emit English artifacts
- **Code comments** — follow the existing language of the file
- **Product / fixture strings** — `nl-NL` locale samples, spreadsheet example data, user-visible copy in locale files
- **Historical GitHub comments** — do not rewrite unless asked; **do** translate Dutch **issue/PR bodies** and **repo docs** when found

## Agent checklist

1. User spoke Dutch → still write the spec, plan, issue, and comments in English.
2. Before `gh issue create` / `gh pr create`: reread the title and body; no Dutch function words.
3. Before handoff: `pnpm run check:agent-docs` (link check + English prose scan).

Enforced in CI via `check:agent-docs` (runs inside `ci:quality:apps`). Policy row: [POLICY.md](../../POLICY.md). Cursor always-apply: [`.cursor/rules/github-english.mdc`](../../../.cursor/rules/github-english.mdc).
