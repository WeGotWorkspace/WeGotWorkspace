# Data directory outside the web root

Derived from [spec.md](./spec.md).

## Goal

Fresh installs keep the database and keys outside the published tree, and say so when they cannot.

## Budget

Draws from the security-hardening milestone. No product goal is displaced.

## Non-goals

- Moving `packages/api/.env`.
- Automatic migration of existing installs.
- A full install-matrix cell for every fallback shape.

## What exists

- `WGW_DATA_DIR` is already read at runtime. `path: packages/api/config/wgw.php:11`
- The installer fallback string is `./wgw-content`. `path: packages/api/app/Services/Installer/InstallerEnvWriter.php:89`
- Headless install goes through `WgwInstallEnv::headlessPlan()`. `path: packages/api/app/Services/Installer/WgwInstallEnv.php:68`
- Admin warnings are a list of strings. The APP_URL warning is at `path: packages/api/app/Services/Admin/AdminStateService.php:102` (the issue text said line 98).
- `pathIfInsideInstallRoot()` is used once, at `path: packages/api/app/Services/Installer/InstallerWizardService.php:731`.
- Docker content was mounted at `/var/www/html/wgw-content`. `path: docker/install/docker-compose.yml:15`
- `tools/e2e-install-matrix.sh` does not mount that volume. It only execs artisan at `/var/www/html/packages/api`. The docker run in that script now sets `WGW_DATA_DIR` and `WGW_STORAGE_PATH`. `path: tools/e2e-install-matrix.sh:1`
- The upgrade e2e still mounts the in-tree path because the published baseline image wrote `WGW_DATA_DIR=./wgw-content`. The same volumes are also mounted at `/var/wgw`. `WGW_DATA_DIR` is not set in that script, so the baseline data stays visible. `path: tools/e2e-upgrade.sh:1`

## Considered

Considered: honour every set `WGW_DATA_DIR`, including `./wgw-content` — rejected because `.env.example` ships that value and Laravel loads it before the installer runs. The stock value is ignored. Any other value is kept.

## Affected packages

- packages/api
- packages/apps
- docker/install
- INSTALL.md

## Dependencies

Resolver before the wizard, headless plan, admin warning, and Docker env.

## Open decisions

None.

## Invariants

- An explicit `WGW_DATA_DIR` other than the stock default is not replaced, and no sibling directory is created. Proof: `path: packages/api/tests/Unit/Installer/DataDirCandidateResolverTest.php` assertion `test_explicit_data_dir_is_returned_unchanged`.
- A second install that shares a parent does not write into the first install's data directory. Proof: `path: packages/api/tests/Unit/Installer/DataDirCandidateResolverTest.php` assertion `test_second_install_sharing_a_parent_falls_back_instead_of_sharing`.
- A fresh wizard install whose parent is writable stores the database outside the document root and can read the admin user back. Proof: `path: packages/api/tests/Feature/Installer/DataDirInstallTest.php` assertion `test_fresh_install_puts_the_database_outside_the_document_root`.
- Installer tests that pin `WGW_DATA_DIR` to the in-tree fixture still install there. Proof: `path: packages/api/tests/Feature/Installer/InstallerWizardTest.php` assertion `test_happy_path_creates_first_admin_and_sets_realm`.
- After the resolver, the wizard, and the warning, a pinned in-tree install still completes. Proof: `cmd: composer --working-dir packages/api exec phpunit -- tests/Feature/Installer/InstallerWizardTest.php tests/Unit/Installer/WgwInstallEnvTest.php`.

## Chunks

### Chunk A: Resolver, both install paths, warning, Docker, docs
- **id:** `chunk-a-data-dir`
- **Skill:** api
- **Inputs:** installer env fallback — `path: packages/api/app/Services/Installer/InstallerEnvWriter.php:89`
- **Done when:** the acceptance criteria in #1329 hold for the beta slice, except the live AllowOverride HTTP check which needs a running container.
- **Verify with:** `composer --working-dir packages/api exec phpunit -- tests/Unit/Installer/DataDirCandidateResolverTest.php tests/Feature/Installer/DataDirInstallTest.php`
- **Parallel with:** none
