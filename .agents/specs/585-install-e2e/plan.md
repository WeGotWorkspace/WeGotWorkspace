# Install e2e matrix

Derived from [spec.md](./spec.md). Chunk layout for implementation on `test/install-e2e-matrix`.

## Goal

Four-cell wizard smoke (ZIP/Docker × SQLite/MariaDB 11) plus CI triggers: path-filter on `main` (not blocking), unfiltered tag gate before publish.

## Non-goals

- See [spec.md](./spec.md)

## Affected packages

- `packages/api` (e2e + playwright config)
- `tools/`
- `.github/workflows/`
- `docs/install-docker-ops.md`
- `packages/api/docs/api-done-gate.md`

## Dependencies

1. Chunk 0 (issue + spec) first
2. Chunk A (Playwright) and Chunk B (harness SQLite) in parallel
3. Chunk C (CI) after A + B contracts exist
4. Chunk D (docs) after harness CLI is stable
5. Chunk E (MariaDB cells) in the same harness/CI matrix as B/C (implemented now, not deferred)

## Chunks

### Chunk 0: Issue + spec

- **id:** `spec-585`
- **Skill:** plan-feature
- **Inputs:** Task #585, parent #584, install e2e matrix plan
- **Done when:** #585 title/AC cover the 4-matrix, phasing, path-filter main, unfiltered tag-gate; this folder exists with matching `Source:` body-hash
- **Verify with:** `gh issue view 585 --json body --jq .body | shasum -a 256` vs spec header
- **Parallel with:** none

### Chunk A: Playwright wizard + login spec

- **id:** `playwright-install-fresh`
- **Skill:** testing
- **Inputs:** existing `install.wizard.spec.ts`, install-core copy, login-core copy
- **Done when:** `packages/api/e2e/install.fresh.spec.ts` walks the wizard, creates admin, signs in, optional API write; fails hard if already installed; gated by `WGW_INSTALL_FRESH=1`
- **Verify with:** harness ZIP+SQLite against a deploy ZIP
- **Parallel with:** `harness-install-matrix`

### Chunk B: Harness (SQLite cells)

- **id:** `harness-install-matrix`
- **Skill:** testing + dev-environment
- **Inputs:** `tools/e2e-env-first-install.sh` patterns, `Dockerfile.runtime`, compose
- **Done when:** `tools/e2e-install-matrix.sh` + `pnpm test:install-e2e` run `zip sqlite` and `docker sqlite`; interface already matrix-ready (`CHANNEL` × `DB`)
- **Verify with:** `pnpm test:install-e2e -- zip sqlite` when a ZIP exists
- **Parallel with:** `playwright-install-fresh`

### Chunk C: CI triggers

- **id:** `ci-install-e2e`
- **Skill:** git-workflow / testing
- **Inputs:** A + B; `ci.yml` Playwright cache; `release.yml` publish sequence
- **Done when:** reusable workflow (ZIP artifact + 4-cell matrix); `install-e2e.yml` path-filtered `main` + `workflow_dispatch` (not required to merge); `release.yml` calls the reusable workflow before GHCR/upload; timeouts and artifact policy as spec
- **Verify with:** workflow YAML review; `workflow_dispatch` after push
- **Parallel with:** none (after A + B)

### Chunk D: Docs

- **id:** `docs-install-e2e`
- **Skill:** document
- **Inputs:** harness CLI
- **Done when:** maintainer notes: not in composer done-gate; how to run locally
- **Verify with:** read the two doc files
- **Parallel with:** `ci-install-e2e`

### Chunk E: MariaDB 11 cells

- **id:** `harness-mariadb`
- **Skill:** testing
- **Inputs:** Chunk B script interface
- **Done when:** `zip mysql` and `docker mysql` use `mariadb:11`; same main path-filter + tag-gate
- **Verify with:** script review; local ZIP+MariaDB if a ZIP and Docker are available
- **Parallel with:** implemented with B/C (not deferred)

## Test plan

- [ ] Local: ZIP+SQLite green when a deploy ZIP can be built or reused
- [ ] Docker+SQLite / MariaDB cells: harness present; full image run is optional locally
- [ ] `workflow_dispatch` on the branch before merge
- [ ] Merge that touches installer paths: 4-cell matrix on that commit, not blocking
- [ ] Tag: unfiltered matrix must be green before publish; existing post-publish smoke stays

## Doc updates

- `docs/install-docker-ops.md` — wizard matrix vs post-publish compose smoke
- `packages/api/docs/api-done-gate.md` — this smoke is not in `composer done-gate`
