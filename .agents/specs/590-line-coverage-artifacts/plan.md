# Line-coverage artifacts

Derived from [spec.md](./spec.md).

## Goal

Main-only coverage artifacts with no percent gate.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- `.github/workflows/ci.yml`
- `packages/apps/scripts/run-jsdom.mjs`

## Dependencies

None. Independent of the install e2e matrix.

## Chunks

### Chunk A: Coverage jobs

- **id:** `coverage-590`
- **Skill:** testing
- **Inputs:** `phpunit.xml` source include, `run-jsdom.mjs`, `ci.yml`
- **Done when:** clover upload fails closed on an empty report; jsdom argv test locks unique blob paths and reports directories; workflow merges blobs
- **Verify with:** `pnpm --filter @wgw/apps exec vitest run --project unit scripts/run-jsdom-coverage.test.mjs`
- **Parallel with:** none

## Test plan

- [ ] Argv unit test
- [ ] Direct `phpunit --coverage-text` is not required in this environment if pcov is absent; the workflow step is the measurement check
