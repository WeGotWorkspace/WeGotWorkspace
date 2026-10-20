Source: ad-hoc

# Release channels: stable, beta, edge

Technical translation of the release-channel decision for launch. ZIP and Docker installs follow the same feed per channel.

## Goal

Ship three update channels. **Stable** is every `vX.Y.Z` tag (GitHub's `releases/latest`). **Beta** is every `vX.Y.Z-<pre>` tag plus every stable tag, whichever is newer. **Edge** is every merge to `main`, versioned `<next patch>-edge.<run>` after a release, or `X.Y.Z-edge.<run>` while `VERSION` is a prerelease of `X.Y.Z` (`tools/edge-version.mjs`). A ZIP install picks its channel in Admin → Updates. A Docker install picks it with `setup.sh --channel` and stores it in the compose `.env`.

## Non-goals

- No nightly or scheduled build. Edge runs per merge with `cancel-in-progress`.
- No downgrade path. Schema migrations only go forward. A channel switch to an older release keeps the installed version.
- No automatic Docker upgrades (Watchtower). Docker stays operator-initiated.
- No cleanup of old `-edge.N` image tags in GHCR yet.

## Affected packages

- packages/api | packages/apps | packages/openapi-types | tools | .github/workflows | docker/install | docs

## Technical constraints

- A prerelease tag must never become GitHub's "Latest" release, or the stable feed offers it to every install.
- `manifest.json` is built once and copied to channel feeds unchanged, so `package_url` and `notes_url` point at the hosting release, not at the feed folder.
- The installer seeds `WGW_UPDATE_FEED_URL` with the stable feed. That value is not an override; any other URL is.
- The GitHub API fallback for `releases/download/<tag>/manifest.json` must read that tag, never `releases/latest`.
- `setup.sh` runs under POSIX `sh` (dash on Ubuntu) with `set -eu`.

## Edge cases

- Beta tag published after a newer stable: the beta feed keeps the newer version (`publish-release-channel.mjs` compares semver).
- Stable tag after a beta of the same version: `1.0.0` sorts above `1.0.0-beta.N`; beta installs move to it.
- Edge to stable: the stable release is older than `X.Y.Z-edge.N` until `X.Y.Z` ships; `setup.sh upgrade` stays put and the Admin updater shows no update.
- Edge to beta: a beta or rc of the same `X.Y.Z` is never offered to an edge install, because edge builds of `X.Y.Z` run before and after those tags. It waits for a newer edge build, a higher `X.Y.Z`, or the `X.Y.Z` release (`ReleaseVersion::isUpgrade`, `edge_skips`).
- The API, `setup.sh` and `publish-release-channel.mjs` use the same semver order: `X.Y.Z-beta.N < X.Y.Z-edge.N < X.Y.Z-rc.N < X.Y.Z`. PHP `version_compare` is not used: it sorts `edge` below `beta`.
- Docker install opens Admin → Updates: channel is shown read-only; `PUT /admin/updates/channel` returns 409 with the `setup.sh` command.
- Channel change while an update runs: 409.
