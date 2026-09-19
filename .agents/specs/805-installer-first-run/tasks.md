# Engineering tasks — Installer first-run flow

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which technical piece lands in which chunk.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-live-route` | builder | workspace | `packages/apps/src/install-core/src/install-app.tsx`, `install-first-run-workspace.tsx`, `use-install-first-run-controller.ts`, `wegotworkspace-routes.tsx` | `pnpm --dir packages/apps exec vitest run src/install-core` | done |
| `chunk-b-env-flag` | builder | api | `packages/api/app/Services/Installer/WgwInstallEnv.php`, `InstallerWizardService.php`, `install-models.tsx` | `php vendor/bin/phpunit tests/Unit/Installer` | done |
| `chunk-c-docs-e2e` | builder | document | `packages/apps/docs/workspace-shells.md`, `INSTALL.md`, `docs/getting-started.md`, `packages/api/e2e/install.wizard.spec.ts` | review + targeted vitest | done |

## Notes

- Chunk `id` values must match `plan.md`.
- On scope change: update Epic #805 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
