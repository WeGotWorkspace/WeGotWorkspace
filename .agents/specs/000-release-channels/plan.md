# Release channels: stable, beta, edge

Derived from [spec.md](./spec.md). Sequential chunks on one branch.

## Goal

See [spec.md](./spec.md#goal).

## Budget

Launch prerequisite. Displaces no Adopted v0.9 work.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- Tag builds publish to GitHub Releases and GHCR; `:latest` moves only on plain semver tags. `path: .github/workflows/release.yml:1`
- The release upload did not set `prerelease`, so a suffixed tag became "Latest". `path: .github/workflows/release.yml:1`
- ZIP Admin updater reads one feed URL (`WGW_UPDATE_FEED_URL`). `path: packages/api/app/Services/Update/UpdateOperationsService.php:1`
- Docker `setup.sh check|upgrade` reads the same stable manifest and pins `WGW_IMAGE`. `path: tools/setup-docker-install.sh:1`
- The repository is public, so GitHub-hosted runners cost nothing; the limit is concurrency. [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)

## Considered

Considered: a separate feed host (own domain) — rejected for launch; rolling GitHub prereleases (`channel-beta`, `channel-edge`) need no new infrastructure. Considered: nightly edge — rejected; per-merge with `cancel-in-progress` gives fresher builds at no cost. Considered: names `nightly`, `canary`, `dev` — rejected (schedule promise, staged-rollout meaning, clash with the dev environment).

## Affected packages

- packages/api | packages/apps | packages/openapi-types | tools | .github/workflows | docker/install | docs

## Dependencies

1. Prerelease flag in `release.yml` (blocks any beta tag).
2. Manifest URLs + channel publisher + edge workflow.
3. API channel setting and feed resolution.
4. Admin UI channel picker.
5. `setup.sh --channel`.

## Open decisions

None — every choice for this work is made.

## Invariants

- A stable install never sees a prerelease. Proof: `path: tools/setup-docker-install.test.mjs` assertion `release workflow never makes a prerelease Latest`.
- Seeded stable feed URL follows the channel; a custom URL wins. Proof: `path: packages/api/tests/Unit/Support/UpdateFeedDefaultsTest.php` assertion `test_the_seeded_stable_feed_url_follows_the_channel`.
- A channel feed fallback never reads `releases/latest`. Proof: `path: packages/api/tests/Unit/Services/Update/ReleaseFeedClientTest.php` assertion `test_channel_feed_falls_back_to_its_own_release_not_latest`.
- Prereleases sort below their release in every comparer. Proof: `cmd: node --test tools/publish-release-channel.test.mjs tools/setup-docker-install.test.mjs`.

## Chunks

### Chunk A: CI channels

- **id:** `chunk-a-ci-channels`
- **Skill:** git-workflow
- **Inputs:** release workflow — `path: .github/workflows/release.yml:1`
- **Done when:** tags publish to the beta feed, merges to main publish to the edge feed, prereleases are never Latest.
- **Verify with:** `node --test tools/publish-release-channel.test.mjs tools/build-wegotworkspace-release.test.mjs`
- **Parallel with:** none

### Chunk B: API channel setting

- **id:** `chunk-b-api-channel`
- **Skill:** api
- **Inputs:** feed resolution — `path: packages/api/app/Services/Update/UpdateOperationsService.php:1`
- **Done when:** `PUT /admin/updates/channel` writes `WGW_UPDATE_CHANNEL`; state reports `updateChannel`.
- **Verify with:** `vendor/bin/phpunit tests/Feature/Admin/AdminUpdateChannelTest.php`
- **Parallel with:** none

### Chunk C: Admin UI

- **id:** `chunk-c-admin-ui`
- **Skill:** apps-ui
- **Inputs:** updates pane — `path: packages/apps/src/admin-core/src/admin-updates-pane.tsx:1`
- **Done when:** ZIP installs pick a channel; Docker shows it read-only with the `setup.sh` command.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/admin-core/src/admin-updates-pane.test.tsx`
- **Parallel with:** none

### Chunk D: Docker setup.sh

- **id:** `chunk-d-setup-channel`
- **Skill:** testing
- **Inputs:** lifecycle script — `path: tools/setup-docker-install.sh:1`
- **Done when:** `--channel` picks the feed, saves to `.env`, and a switch never downgrades.
- **Verify with:** `node --test tools/setup-docker-install.test.mjs`
- **Parallel with:** none

## Test plan

- [ ] API: feature + unit tests for the channel endpoint, feed resolution, and API fallback
- [ ] UI: Vitest for the channel picker, edge warning, and Docker read-only view; Storybook `EdgeChannel`
- [ ] Tools: node tests for semver order, channel publisher, manifest URLs, `setup.sh`

## Doc updates (only if user wants)

- INSTALL.md, docs/install-docker.md, docs/env.md
