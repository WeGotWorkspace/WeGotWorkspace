# Collab / text-editor hook layout

Expected module layout for hooks under `packages/apps/src/text-editor-core/docs-collab/` (and similar Yjs + TipTap features). Load this when adding or refactoring collab hooks — not when touching workspace shell controllers ([feature-blueprint.md](feature-blueprint.md) covers `use*Shell` / `use*Controller` only).

## Target shape

Split by concern so the orchestrator hook stays thin (~150 lines) and testable pure modules own CRDT/editor logic.

| Module | Owns |
|--------|------|
| `docs-comments-schema.ts` | Zod schema + parse/validate at the Yjs boundary |
| `docs-comments-map.ts` | Read Y.Map → typed domain objects |
| `docs-comments-map-writes.ts` | Pure Yjs writes (no React) |
| `docs-comments-editor-actions.ts` | Pure TipTap selection/mark commands (no React) |
| `use-docs-comments-draft.ts` | Draft lifecycle |
| `use-docs-comments-selection.ts` | Selection tracking + auto-activate |
| `use-docs-comments-active.ts` | Active thread state |
| `use-docs-comments-outside-click.ts` | DOM pointer/outside-click listeners |
| `use-docs-comments.ts` | Orchestration + public API only |

Reference implementation: `feature/docs-comments-sidebar` — `use-docs-comments.ts` (~150 lines) composing sub-hooks and pure modules.

## Precedent / debt

`use-docs-collab.ts` (~990 lines) predates this layout. **Do not copy it as the pattern for new hooks.** Note it as debt when touching adjacent code; do not expand scope to refactor it unless the user explicitly asks.

## When to split during a feature

After **two or more unrelated concerns** land in one hook (e.g. Yjs sync + draft UI + DOM listeners), run a **structure pass before handoff** — extract pure `*.ts` modules and focused sub-hooks. CI size limits (`pnpm check:hook-size`) and review prompts: [clean-code/smells.md](../clean-code/smells.md) (React hooks section) and [code-review/SKILL.md](../code-review/SKILL.md).

## Testing

Extract pure parsers, state machines, and Yjs/CRDT writes to `*.ts` and test directly. Hook tests assert orchestration contracts only — not every branch already covered by pure modules. See [testing/ui-architecture.md](../testing/ui-architecture.md).

## Plan chunks

For collab UI features, plan explicit **orchestrator vs pure lib** chunk boundaries ([plan-feature/SKILL.md](../plan-feature/SKILL.md)) — e.g. one chunk for schema + map writes + editor actions (Vitest on pure exports), another for sub-hooks + thin orchestrator (RTL on public hook API).
