# Installer first-run flow

Derived from [spec.md](./spec.md). Sequential: Storybook screens already exist; this slice wires live `/install`.

## Goal

Swap live `/install` onto the signed-off first-run screens and keep installer API actions.

## Non-goals

- Headless env key changes
- Admin Mail / Meet / Email delivery redesign

## Affected packages

- packages/apps
- packages/api
- docs

## Dependencies

1. First-run presentational screens (already on `feat/installer-first-run`)
2. Shared password `Input` (already on the branch)
3. Installer API actions (existing)

## Chunks

### Chunk A: Live first-run workspace

- **id:** `chunk-a-live-route`
- **Skill:** workspace
- **Inputs:** Epic #805 AC; `Installer*Page` screens
- **Done when:** `InstallerApp` and the `/install` mock route render first-run chrome; Get started / Database / Account / Ready / interrupt call existing operations
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/installer-core`
- **Parallel with:** chunk-b-env-flag

### Chunk B: Env database flag + optional checks

- **id:** `chunk-b-env-flag`
- **Skill:** api
- **Inputs:** `WgwInstallEnv`, `InstallerWizardService::runtimeState`
- **Done when:** runtime state includes `db_from_env`; optional IMAP maps to warn and is omitted from the interrupt UI
- **Verify with:** `php vendor/bin/phpunit tests/Unit/Installer` (from `packages/api`)
- **Parallel with:** chunk-a-live-route

### Chunk C: Docs + e2e

- **id:** `chunk-c-docs-e2e`
- **Skill:** document
- **Inputs:** workspace-shells.md, INSTALL.md, getting-started.md, `install.wizard.spec.ts`
- **Done when:** docs describe first-run (not eight Split steps); e2e asserts first-run copy
- **Verify with:** e2e file review; `pnpm --dir packages/apps exec vitest run src/installer-core`
- **Parallel with:** none (after A+B)

## Test plan

- [ ] Vitest: first-run flow helpers (env skip, blocking checks, install payload)
- [ ] PHPUnit: `db_from_env` when `WGW_INSTALL_DB_DRIVER` is set
- [ ] Playwright: `/install` shows first-run Welcome, not “What you'll set up”
- [ ] Storybook first-run stories remain the visual contract
