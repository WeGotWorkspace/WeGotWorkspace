# Engineering tasks — Fresh install e2e matrix

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `install-harness` | builder | testing | `tools/e2e-install-matrix.sh`, `tools/api-e2e/e2e/install.fresh.spec.ts`, `package.json` | missing-vendor harness exit 1 | done |
| `install-ci` | builder | testing | `.github/workflows/install-e2e.yml`, `.github/workflows/install-e2e-reusable.yml`, `.github/workflows/release.yml`, `docker/install/Dockerfile.runtime`, `docs/install-e2e.md`, `.github/dependabot.yml` | workflow review | done |

## Notes

- Issue #585 body could not be edited (`updateIssue` denied). Spec header hashes the live body and records the first-run translation.
- `zip-sqlite` starts in the release gate. The other cells are observe-only until two consecutive greens.
