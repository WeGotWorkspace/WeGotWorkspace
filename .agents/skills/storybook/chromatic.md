# Chromatic visual regression

Chromatic captures Storybook snapshots for visual regression. Enablement is tracked in [#85](https://github.com/WeGotWorkspace/wegotworkspace/issues/85). CI runs only when the repo variable `CHROMATIC_ENABLED` is `true` and secret `CHROMATIC_PROJECT_TOKEN` is set.

**Policy:** optional for new work; not part of `pnpm test:apps-done-gate`. See [.agents/POLICY.md](../../POLICY.md) and [apps-done-gate.md](../testing/apps-done-gate.md).

### Issue #85 scope

| Slice | Status | Notes |
|-------|--------|-------|
| Document gating policy + CI wiring | **Done** (this doc, `POLICY.md`, `apps-done-gate.md`) | Single dedicated job; hard-fail on unaccepted diffs |
| Create project, token, enable variable | Maintainer | `CHROMATIC_PROJECT_TOKEN` secret + `CHROMATIC_ENABLED=true` |
| Accept baselines on `main` | Automatic after enable | `autoAcceptChanges: "main"`; PR diffs still require review |

## Current gating policy

| Setting | Value | Effect |
|---------|-------|--------|
| `exitZeroOnChanges` | `false` | Unaccepted visual diffs **fail** the Chromatic CI check |
| `autoAcceptChanges` | `"main"` only | Pushes to `main` update baselines; never all branches |
| `onlyChanged` (TurboSnap) | `true` | Limits snapshot count to stories affected by the diff |
| Live stories | `parameters.chromatic.disableSnapshot: true` | `Features/Workspace/Live` and `Features/Workspace/Live/Shell` are not snapshotted |
| Storybook animations | disabled in `.storybook/chromatic-reduced-motion.css` | Chromatic pauses CSS animations. Radix waits for `animationend`, so exit animations must be `none` or menus and dialogs stay mounted during `play` |
| Repo variable `CHROMATIC_ENABLED` | must be `true` | Chromatic job is skipped when unset / not `true` |

Free tier is ~5k snapshots/month; TurboSnap and smoke-only Storybook Vitest help stay within budget. Full mock-tier catalog is **111 exported surfaces** (~101 story files); Live titles are excluded from Chromatic.

## CI wiring

File: `.github/workflows/ci.yml`

When `vars.CHROMATIC_ENABLED == 'true'` (and not a release-commit push):

- **`chromatic` job** (single publish path):
  - Storybook is built with `pnpm exec storybook build` before upload, so the action does not spawn its own Storybook build.
  - `chromaui/action@v18` with `workingDir: packages/apps` and `storybookBuildDir: storybook-static`
  - Checkout `fetch-depth: 0` for TurboSnap history
  - `onlyChanged: true`, `exitZeroOnChanges: false`, `autoAcceptChanges: "main"`
  - `projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}`

There is **no** second Chromatic publish in the `build` job. Do **not** use `pull_request_target` for this workflow.

Chromatic is **not** part of branch-protection required checks until maintainers explicitly add it.

## Enablement checklist (maintainers — requires secrets)

Complete in order; steps 1–2 need org/repo admin access:

- [ ] Create a Chromatic project linked to this repo (GitHub integration recommended).
- [ ] Add repository secret `CHROMATIC_PROJECT_TOKEN` (project token from Chromatic → Manage → Configure).
- [ ] Set repository variable `CHROMATIC_ENABLED` to `true` (Settings → Secrets and variables → Actions → Variables).
- [ ] Trigger CI on a PR; open the Chromatic build link from the job log.
- [ ] Confirm `main` auto-accepts baselines and PR unaccepted diffs fail the check.
- [ ] Confirm TurboSnap (`onlyChanged`) behaves as expected on a small UI PR.
- [ ] Confirm Live stories (`Features/Workspace/Live*`) are not snapshotted.

## Local development (no token required)

Storybook and Vitest smoke cover offline visual confidence without Chromatic:

```bash
pnpm dev                       # Storybook at http://127.0.0.1:6006
pnpm test:apps-done-gate       # includes Storybook Vitest smoke + a11y gate
```

Optional local publish when you have a project token:

```bash
export CHROMATIC_PROJECT_TOKEN=chpt_…   # never commit
pnpm --filter @wgw/apps run chromatic
```

Package script: `packages/apps/package.json` → `"chromatic": "chromatic --build-script-name build-storybook"`.

Storybook addon: `@chromatic-com/storybook` in `packages/apps/.storybook/main.ts`.

## Agent guidance

- Do **not** ask for or commit `CHROMATIC_PROJECT_TOKEN`.
- Do **not** snapshot Live-tier stories; keep `chromatic.disableSnapshot: true` on Live metas.
- When touching stories, rely on mock-tier coverage, `vitest-ci` smoke, and a11y gate per [offline-first.md](offline-first.md).
