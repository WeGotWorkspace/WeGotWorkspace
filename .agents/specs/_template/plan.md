# [Feature title]

Derived from [spec.md](./spec.md). Chunk layout for parallel or sequential implementation.

## Goal

[One paragraph — same intent as spec, or link to spec section]

## Budget

Draws from budget X, displaces Y.

## Non-goals

- …

## What exists

- [Claim about existing code, a dependency, or issue status.] `path: packages/api/app/Example.php:1`

## Considered

Considered: [existing component], [alternative] — chosen or rejected because [reason].

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

[Ordered list — what must complete before what]

## Open decisions

None — every choice for this work is made. Replace with checkboxes tied to a chunk id while a choice is still open.

## Invariants

- [Behavior that must keep working]. A wrong change [what breaks]. Proof: `path: packages/api/tests/ExampleTest.php` assertion `test_name`, or a command that shows a silent miss.
- After chunk A, main still works without the next chunk. Proof: the test or command named above.

## Chunks

### Chunk A: [name]

- **id:** `chunk-a-slug`
- **Skill:** api | apps-ui | workspace | testing | document | storybook
- **Inputs:** cited claim — `path: packages/api/app/Example.php:1`
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
