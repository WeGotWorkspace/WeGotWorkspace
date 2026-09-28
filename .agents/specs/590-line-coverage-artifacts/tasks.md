# Engineering tasks — Line-coverage artifacts

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `coverage-590` | builder | testing | `.github/workflows/ci.yml`, `packages/apps/scripts/run-jsdom.mjs`, `packages/apps/scripts/run-jsdom-coverage.test.mjs` | vitest unit test for coverage argv | done |
