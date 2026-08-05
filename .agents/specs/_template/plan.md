# [Feature title]

Derived from [spec.md](./spec.md). Chunk layout for parallel or sequential implementation.

## Goal

[One paragraph — same intent as spec, or link to spec section]

## Non-goals

- …

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

[Ordered list — what must complete before what]

## Chunks

### Chunk A: [name]

- **id:** `chunk-a-slug`
- **Skill:** api | apps-ui | workspace | testing | document | storybook
- **Inputs:** …
- **Done when:** …
- **Verify with:** command or checklist
- **Parallel with:** chunk IDs or "none"

Optional final chunk after parallel builds merge:

- **Chunk V: Cross-chunk verify** — read-only verifier subagent; prompt from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md); `done-when`: verifier `PASS` or `PASS_WITH_NITS` and parent ran [done-checklist](../../skills/developer/done-checklist.md).

## Test plan

- [ ] API: OpenAPI → failing feature test → implement → `composer done-gate`
- [ ] UI: mock-tier Storybook → Vitest for logic → optional `play` for critical flows
- [ ] …

## Doc updates (only if user wants)

- …
