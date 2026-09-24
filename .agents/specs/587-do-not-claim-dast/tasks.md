# Engineering tasks — Do not claim DAST until it runs

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `docs-honest-scanners` | builder | document | `SECURITY.md`, `CONTRIBUTING.md`, `README.md`, `.github/ISSUE_TEMPLATE/dast-finding.yml`, `.github/zap/README.md` | `pnpm run check:agent-docs` plus the grep in `plan.md` | pending |

## Notes

- Chunk `id` matches `plan.md`.
- `README.md` is in the path list so the Security CI bullet is re-read. Expect no edit if it still names only CodeQL, Semgrep, Gitleaks, and Trivy.
- Do not edit `.github/workflows/security.yml`.
- Update **status** to `done` when the chunk lands.
- On scope change: update issue `#587` first, then re-sync spec/plan/tasks and the `Source:` body-hash in `spec.md`.
