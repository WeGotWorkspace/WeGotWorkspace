# Engineering tasks — Install e2e matrix

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `spec-585` | planner | plan-feature | `.agents/specs/585-install-e2e/`, issue #585 | `gh issue view 585 --json body --jq .body \| shasum -a 256` vs spec `Source:` | done |
| `playwright-install-fresh` | builder | testing | `packages/api/e2e/install.fresh.spec.ts`, `packages/api/playwright.config.mjs` | `WGW_INSTALL_FRESH=1` via harness | done |
| `harness-install-matrix` | builder | testing | `tools/e2e-install-matrix.sh`, `package.json` | `pnpm test:install-e2e -- zip sqlite` | done |
| `ci-install-e2e` | builder | testing | `.github/workflows/install-e2e.yml`, `install-e2e-reusable.yml`, `release.yml` | YAML review | done |
| `docs-install-e2e` | documenter | document | `docs/install-docker-ops.md`, `packages/api/docs/api-done-gate.md` | read the two files | done |
| `harness-mariadb` | builder | testing | `tools/e2e-install-matrix.sh`, reusable matrix cells | `pnpm test:install-e2e -- zip mysql` | done |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update **#585 first**, then re-sync spec/plan/tasks and the `Source:` body-hash.
