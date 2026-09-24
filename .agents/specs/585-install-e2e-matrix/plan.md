# Fresh install e2e matrix

Derived from [spec.md](./spec.md).

## Goal

Ship the four-cell fresh-install harness and wire it so a tag tests the same ZIP and the same amd64 digest that get published.

## Non-goals

See [spec.md](./spec.md).

## Affected packages

- `tools`, `tools/api-e2e`, `.github/workflows`, `docker/install`, `docs`, `.github/dependabot.yml`

## Dependencies

1. Playwright spec and harness.
2. Reusable workflow and path-filtered `install-e2e.yml`.
3. `release.yml` split: build → candidate digest → gate and observe → imagetools and asset upload → smoke → annotate.

## Chunks

### Chunk A: Harness

- **id:** `install-harness`
- **Skill:** testing
- **Inputs:** first-run installer copy, `tools/api-e2e/playwright.config.mjs`, release ZIP layout
- **Done when:** `install.fresh.spec.ts` walks the first-run UI and checks `/api/v1/me`; harness fails when `vendor/` is missing; `pnpm test:install-e2e` accepts `CHANNEL` and `DB`
- **Verify with:** harness against a tree with no `vendor/`; ZIP+SQLite when a release ZIP is available
- **Parallel with:** none

### Chunk B: CI and release gate

- **id:** `install-ci`
- **Skill:** testing
- **Inputs:** chunk A, `release.yml`, `Dockerfile.runtime`
- **Done when:** one ZIP artifact, candidate digest, `install-gate` / `install-observe`, `:latest` only for stable tags, cleanup, Dependabot docker entry, maintainer doc
- **Verify with:** workflow YAML review; `docs/install-e2e.md` covers GHCR access and **Re-run all jobs**
- **Parallel with:** none

## Test plan

- [ ] Missing `vendor/` exits non-zero without `WGW_INSTALL_E2E_DEV_COMPOSER=1`
- [ ] ZIP+SQLite cell against a release ZIP that already contains `vendor/`
- [ ] Workflow `if:` skips an empty cell list instead of calling `fromJSON` on `[]`
