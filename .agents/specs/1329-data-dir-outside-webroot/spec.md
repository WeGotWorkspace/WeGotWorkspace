Source: #1329 (body-hash: 254a35a8)

# Data directory outside the web root

Technical translation of the beta slice of #1329. A fresh install stores the database, signing keys, and backups outside the published tree when a writable parent exists. Otherwise it keeps `./wgw-content` and records a standing admin warning.

## Goal

Stop new installs from placing `WGW_DATA_DIR` inside the folder the web server publishes, on both the web wizard and `php artisan wgw:install`, without moving data that is already installed.

## Non-goals

- Relocating `packages/api/.env` (step 3).
- An assisted move, or any automatic migration of an existing install.
- The later fallback install-matrix cell beyond one install that proves fallback, the warning, and a collision.

## Affected packages

- packages/api
- packages/apps
- docker/install
- INSTALL.md

## Technical constraints

- Resolution keys off `WgwInstallConfig::installRoot()`, not `DOCUMENT_ROOT`, because headless install has no document root. When `DOCUMENT_ROOT` is present and differs from the install root, the sibling of the real document root is also considered.
- `WGW_DATA_DIR=./wgw-content` and `wgw-content` are the stock default shipped in `.env.example`. Treating them as an operator override would leave every ZIP install inside the web root. Any other value is returned unchanged.
- Two installs that share a parent must not share a data directory. The first usable name is `<parent>/wgw-content`. If that directory belongs to another install, the next name is `<parent>/wgw-content-` plus the first 8 hex characters of `sha256` of the real install root. A foreign or non-empty directory is not adopted. Fallback to `./wgw-content` remains when no outside candidate can be claimed.
- SQLite's `WGW_DB_DATABASE` is resolved from the install root. A stock `./wgw-content/db.sqlite` is rewritten to `{dataDir}/db.sqlite` when the data directory moves. Any other sqlite path is left as submitted.
- Docker sets `WGW_DATA_DIR=/var/wgw/content` and `WGW_STORAGE_PATH=/var/wgw/storage`. `useStoragePath()` runs only when `WGW_STORAGE_PATH` is set.
- The installer request field lives on `InstallerActionPayload.data_dir` in `openapi.built.json`. `openapi.json` does not describe an installer request body.

## Edge cases

- A symlinked document root is `realpath`'d before the inside-tree comparison.
- An override that is not the proposal is validated the same way and rejected with a specific message. It does not fall back.
- An unused reservation (empty directory plus this install's marker) is removed when the operator picks a different directory.
- Existing installs and any live data directory that still resolves inside the published tree get the admin warning. The warning is computed from the configured path, not from a stored flag.
- Opening the installer claims the chosen directory. That claim is what stops two installs from racing into one folder. A leftover claim of the plain name does not block a later install, because that install uses its own suffixed name.
