# Nightly team simulation

Derived from [spec.md](./spec.md). Delivery issue [#1981](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1981) (Chore).

## Goal

A local, unattended night job plays a fictional 10-person agency against a long-lived instance on `main`, served the way a shared host serves it. It then checks cross-app, cross-user and cross-time invariants and writes a private morning report. The engine is deterministic per date so every finding can be replayed.

## Budget

Draws from hardening (Technical debt and Pioneer bug flow). Displaces nothing on a product milestone: no UI, no API change. Machine cost: one hour of the maintainer's Mac per night, Docker Desktop during that hour, and about 10 GB of Drive data plus the blocks that changed across 14 snapshots, and up to $0.60 of local model use and 10 minutes per night for the persona diaries. The Google background (chunk I) adds four to six habit actions a night, two to four migration imports on weekdays, and no machine cost. Devices and native apps (chunk J) add no actions; they move some to phones and native clients. Phone contexts stay inside the three to four browser personas a night, so memory use does not grow; WebKit adds one browser download. Phase 2 (fault injection, shrinking, coverage steering) is not in this budget; it is decided after three nights.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The host dev server runs `wgw:schema-migrate`, then `php -S` on a hard-coded `:9080` with `post_max_size=32M`. It sets no `PHP_CLI_SERVER_WORKERS`, so requests are served one at a time. The built-in server ignores `.htaccess` and `.user.ini`, and no scheduler runs next to it. `path: packages/api/scripts/dev-php-server.sh:23`; `path: packages/api/scripts/dev-php-server.sh:27`
- The repository ships an Apache 2.4 + mod_php image for the shared-hosting runtime, with the modules cPanel-style hosts enable. `path: docker/apache/Dockerfile:1`; `path: docker/apache/Dockerfile:31`; `path: docker/README.md:3`
- The dev Compose file runs that image as `web` on `WGW_DOCKER_HTTP_PORT`, bind-mounts the install root, and runs a `scheduler` service that calls `schedule:run` every minute. `path: compose.dev.yml:18`; `path: compose.dev.yml:27`; `path: compose.dev.yml:42`; `path: compose.dev.yml:60`
- Shared-host upload limits for the image are 32M, lockstep-tested. `path: docker/php/uploads.ini:6`
- Large Drive files are uploaded in parts that fit small `post_max_size` and are assembled in bounded steps, so 1 GB uploads do not need raised limits. `path: .agents/specs/1500-chunked-upload-api/spec.md:10`
- Shared hosting has about five PHP-FPM workers; the live-updates design is built on that budget. `path: .agents/specs/1659-live-updates/spec.md:29`
- The production bundle is `vite build`, then `sync:runtime` copies it into the install root that Apache serves. `path: packages/apps/package.json:12`; `path: packages/apps/package.json:13`; `path: packages/apps/scripts/sync-runtime-app-builds.mjs:21`
- Live specs run from `playwright.live.config.mjs` with one worker and `WGW_DISABLE_LOGIN_THROTTLE=1` on the API server. `path: packages/apps/playwright.live.config.mjs:13`
- `wgw:dev-install` creates the `.env` keys, SQLite, an `admin` and a `member` account, idempotently, and migrates; seed commands are allowed only in a local monorepo checkout. The Apache entrypoint runs it on every start, and mints `APP_KEY` only when it is empty, because replacing it breaks share links, refresh tokens and the collab key. `path: packages/api/app/Services/Installer/DevInstallBootstrap.php:21`; `path: packages/api/app/Services/Installer/DevInstallBootstrap.php:50`; `path: docker/apache/docker-entrypoint.sh:23` `path: packages/api/routes/console.php:105`; `path: packages/api/app/Services/Installer/DevSeedGuard.php:16`; `path: docker/apache/docker-entrypoint.sh:30`
- No artisan command creates an arbitrary user or group. Users and Teams are created through the admin REST API (`POST admin/users`, `POST admin/groups`, `PUT admin/groups/{group}/members/{username}`). A created user has a username, password, display name, email and groups; there is no quota field. `path: packages/api/routes/api.php:394`; `path: packages/api/app/Http/Requests/Api/V1/AdminUserCreateRequest.php:25`
- Admin is a per-user flag (`users.is_admin`, #1925), not membership of a Team; `POST admin/users` takes `isAdmin`. `path: packages/api/app/Services/Auth/AdminRoleResolver.php:10`; `path: packages/api/app/Http/Requests/Api/V1/AdminUserCreateRequest.php:31`
- On a fresh install `wgw:dev-install` sets `APP_URL` to the dev API origin unless a non-local value is set, and creates Team `team` with `admin` and `member`. RSVP links are built from `APP_URL`. `path: packages/api/app/Services/Installer/DevInstallBootstrap.php:126`; `path: packages/api/app/Services/Installer/ApiRuntimeEnvService.php:127`; `path: packages/api/app/Services/Installer/DevInstallBootstrap.php:168`; `path: packages/api/app/Services/Calendars/CalendarImipService.php:187`
- Login is `POST /api/v1/auth/token` returning a bearer JWT plus a `wgw_refresh` cookie; there are no personal access tokens. API actors log in like the web app. `path: packages/api/routes/api.php:90`
- Each user has a notification inbox (`GET notifications`, ack and local-ack). Web Push subscription routes sit next to it. `path: packages/api/routes/api.php:170`; `path: packages/api/routes/api.php:175`
- Reusable multi-user helpers exist: token login with 429 retry, bearer `api(user, method, path)`, and `openUser(browser, user)` giving each user an isolated browser context. `path: packages/apps/e2e/helpers/live-matrix.ts:28`; `path: packages/apps/e2e/helpers/live-matrix.ts:99`
- A re-runnable user, Team and channel setup that accepts "already exists" is in a live spec. `path: packages/apps/e2e/meet-mesh-channel-roster.spec.ts:75`
- Per-app seed helpers: Drive `putDriveFile` `path: packages/apps/e2e/helpers/drive-seed.ts:9`, Docs `seedDocAtPath` `path: packages/apps/e2e/helpers/docs-live.ts:150`, Calendar `createUtcCalendarEventViaApi` `path: packages/apps/e2e/helpers/calendar-live.ts:147`, Meet guest `openGuest` / `knockAsGuest` `path: packages/apps/e2e/helpers/meet-guest-chat.ts:106`.
- The per-account API budget is 600 requests a minute; live specs reset it with `wgw:e2e-reset-api-budget`. `path: packages/api/app/Http/RateLimiting/WgwApiRateLimiters.php:38`; `path: packages/apps/e2e/helpers/live-test.ts:34`
- JMAP capabilities cover calendars, contacts, file nodes, notes, chat, availability and quota (read-only, RFC 9425); Tasks has its own capability. There is no JMAP mail capability. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:15`; `path: packages/api/app/Services/Tasks/TasksCapabilitiesService.php:24`
- The only storage limit is free disk space; a full disk surfaces as `overQuota`. `path: packages/api/app/Services/Jmap/Blobs/StorageFullException.php:13`
- CalDAV/CardDAV is served at the root with Basic auth. `path: packages/api/routes/web.php:55`; `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:26`
- Data directory and SQLite path come from `WGW_DATA_DIR` and `WGW_DB_DATABASE`. On a fresh install, `wgw:dev-install` creates the database at `./wgw-content/db.sqlite` and rewrites `WGW_DATA_DIR` to a path relative to the install root, falling back to `./wgw-content` for a path outside it. `path: packages/api/config/wgw.php:11`; `path: packages/api/.env.example:101`; `path: packages/api/app/Support/AppPaths.php:141`; `path: packages/api/app/Services/Installer/DevInstallBootstrap.php:116`
- Migrations run file by file through Laravel's migrator, so a failure leaves earlier files applied. `path: packages/api/app/Services/Installer/WgwSchemaMigrator.php:27`
- `compose.dev.yml` is named `wgw-dev`, bind-mounts `./packages/api` and `./apps/wegotworkspace` relative to its own directory, and has a `mailhog` service under the `mail` profile. `path: compose.dev.yml:10`; `path: compose.dev.yml:27`; `path: compose.dev.yml:62`
- App mail (calendar invites, share mail) goes through `MailDeliveryService` with the instance's SMTP settings, not Laravel's `MAIL_MAILER`; the settings are written through `PUT admin/settings`. `path: packages/api/app/Services/MailDelivery/MailDeliveryService.php:37`; `path: packages/api/routes/api.php:405`
- Guests reach Meet rooms, share sessions and download tickets without an account. `path: packages/api/routes/api.php:118`; `path: packages/api/routes/api.php:390`
- The nightly CI job runs the live, chaos and relay suites on a fresh database and opens a public issue on failure. `path: .github/workflows/nightly-live-e2e.yml:94`; `path: .github/workflows/nightly-live-e2e.yml:222`
- The OpenAPI contract lists every REST path template for coverage matching. `path: packages/api/openapi/openapi.json:1`
- `tools/api-e2e` is the precedent for a Playwright workspace package under `tools/`. `path: pnpm-workspace.yaml:5`

## Considered

Considered: extending the existing live tier (`packages/apps/e2e`, run by `nightly-live-e2e.yml`) with long multi-user specs, versus a separate harness. Rejected extending it: the live tier boots a fresh database per run and each spec owns its fixture users, so nothing ages, and its results land in public CI logs. The harness reuses the live tier's helpers and boot knowledge instead of copying them.

Considered: the host `php -S` server (with `PHP_CLI_SERVER_WORKERS` for concurrency), versus the repository's Apache + mod_php image. Rejected `php -S`: it ignores `.htaccess`, runs no scheduler, and is not what customers run, so "upgrade on aged data" would test a path no customer has. The Apache image with a worker cap of 5 serves concurrent requests the way a shared host does, which is where races between personas show up, and the `timing` oracle then measures that stack instead of a single-request queue. The cost is Docker Desktop running during the night.

Considered: GitHub Actions (free for this public repository) as the runner. Rejected for now: logs, traces and auto-filed issues are public, which conflicts with keeping visibility findings private before beta, and every run starts from an empty database. An always-on machine or a self-hosted runner would remove the dependency on the maintainer's Mac without making anything public; it is the next step once the harness has proved its worth. Until then, missed nights are reported so the job cannot stop silently.

Considered: LLM-driven personas that decide each click. Rejected: costly per night, not replayable, and a failure cannot be told apart from a confused agent. The LLM stays outside the loop: corpora are written once and committed; triage of the morning report is done by a maintainer or an agent session. The one exception runs after the night: a cheaper local model writes persona diaries and the weekly digest from the run files, and never feeds the action list or replay.

Considered: the Google background only in the diary prompt ("they used Google before"). Rejected: the model would invent comparisons from general knowledge that may be wrong or out of date, and nothing would be measured. Habits and migration imports are planned actions, and a diary may mention Google only on them.

Considered: a different former platform per persona (Google, Microsoft 365, Dropbox). Rejected by the product lead: a team that each came from somewhere else is not how a studio switches. The whole team moved from Google Workspace together, on purpose, for sovereignty.

Considered: faking the server clock to run a month in one night. Rejected: the server, CalDAV clients, push and browser all read real time, and a faked clock tests a state no user reaches. Real time also makes the workspace age the way a customer's does.

Considered: letting the harness file Bugs itself from oracle failures. Rejected: a failure that does not reproduce on replay would become a public issue, duplicates would pile up night after night, and a visibility finding could slip into a public body. Triage files reproduced bugs directly; the harness only writes the report.

Considered: building fault injection, shrinking and coverage steering in this issue, versus after three nights. Rejected building them now: they would triple the harness before one night has run, on code nobody else touches until it breaks. The first nights show which of them pays off; each one chosen gets its own issue, starting from the design in [spec.md](./spec.md#phase-2-decided-after-three-nights).

Considered: a storage-quota fault. Rejected: the API has no per-account quota to set, free disk is the only limit, and filling the real disk is out of scope. A full-disk run on a small disk image is a candidate for a phase 2 issue.

Considered: taking the snapshot before the upgrade (replay then migrates again on the recorded commit), versus a rollback copy before the upgrade plus a snapshot after migrations and reconcile. Chose the second: replay starts from the exact state the actors started from and never re-runs migrations or reconcile, and the rollback copy is the restore point for a failed upgrade. The cost is a second clone per night, which is cheap with clonefile.

Considered: replaying on the live checkout, versus a scratch worktree at the night's commit with that night's `.env`. Rejected the live checkout: the planner, world and corpora change on `main`, so the action list would drift, and a different `APP_KEY` cannot read sealed data in the snapshot.

Considered: plain copies of the data directory as snapshots, versus APFS clones. Rejected plain copies: 14 copies of a 10 GB Drive is 140 GB. Clones share unchanged blocks; Drive blobs rarely change once written.

Considered: one fresh world per night (seed, act, discard). Rejected: it removes the aged-data and upgrade-on-old-data coverage that is the main reason for the harness.

## Affected packages

- tools/team-sim (new workspace package `@wgw/team-sim`)
- .agents/skills/testing (one page)
- pnpm-workspace.yaml (one line)

## Dependencies

1. `sim-world-planner` and `sim-instance` in parallel.
2. `sim-bootstrap` after `sim-instance`.
3. `sim-api-actors` and `sim-ui-actors` after `sim-world-planner` and `sim-bootstrap`; in parallel with each other.
4. `sim-oracles` after `sim-api-actors` and `sim-ui-actors` (oracles read through the API client and read the browser actors' console and request logs).
5. `sim-report-replay` after `sim-oracles`.
6. `sim-schedule-skill` after `sim-report-replay`.
7. `sim-habits` after `sim-report-replay` (it extends the report's `Team voice` section).
8. `sim-devices` after `sim-habits` (both change the persona profile and the report's `Team voice` section).
9. `sim-verify` last.

## Open decisions

None open. Decided by the product lead for chunk I:

- **Devices** (2026-11-13): Macs on the desk, a mix of iPhone and Android, some people all-in on the web apps, others on their own CalDAV/CardDAV apps (Apple Calendar, Contacts, Reminders). The roster in [spec.md](./spec.md#devices-and-native-apps) is a default the product lead may change.
- **Origin** (2026-11-13): the whole team moved from Google Workspace together, for sovereignty. See [spec.md](./spec.md#moved-from-google-workspace).
- **A freelancer** is decided (2026-11-12, product lead): a different target group, so a separate simulation with its own world (a freelancer's own business with several clients), not a persona in Studio Kade. Not in this plan; it gets its own issue when picked up.

Everything else is decided. Choices made without a separate review: port `:9290` (replay `:9291`); Compose projects `wgw-sim` and `wgw-sim-replay`; Apache worker cap 5; data under `~/.wgw-sim/`; night slot 01:00–02:15 local time via launchd with a `pmset` wake one minute earlier (installed once by the maintainer, it needs `sudo`); a run that starts after 06:00 is skipped as missed; 14 snapshots kept as APFS clones; Drive volume cap 10 GB; convergence sample of 200 older objects per night; weekend nights run the light plan; coverage horizon 14 nights; rollback copy plus a snapshot after migrations and reconcile (not a pre-upgrade snapshot); every app through both actor layers each night, the Meet call itself browser-only; MailHog from `compose.dev.yml` as the SMTP sink, host ports `:2590`/`:2580` (replay `:2591`/`:2581`); dev Team `team` kept as dev seed. Phase 2 is decided by triage after three nights, not in this plan.

## Invariants

- The harness never touches the dev or PR-test instance. A wrong change writes simulation data into the maintainer's dev database or kills a PR test server. Proof: `path: tools/team-sim/src/instance/guard.test.mjs` assertions `refuses a port taken by anything but wgw-sim or wgw-sim-replay`, `replay publishes different MailHog host ports than wgw-sim`, `APP_URL is the project origin`, `updates its own running wgw-sim on :9290`, `refuses a data dir inside a git checkout`, `refuses the dev and PR-test ports`, `refuses a Compose project name other than wgw-sim or wgw-sim-replay`, `refuses a compose file outside the sim worktree`.
- The data the app opens is the mounted data dir. A wrong change leaves the aged database in the worktree, outside every snapshot. Proof: `path: tools/team-sim/src/instance/instance.test.mjs` assertions `after a first and a second boot, the sqlite file the app opens is under ~/.wgw-sim/data`, `web and scheduler mount the same data dir`.
- Snapshots are clones on one volume. A wrong change fills the disk with full copies. Proof: `path: tools/team-sim/src/instance/snapshot.test.mjs` assertions `snapshot uses clonefile`, `refuses data and snapshot dirs on different volumes`, `snapshot is taken with the stack stopped`, `snapshot is post-reconcile and replay does not reconcile`.
- A failed upgrade leaves the instance as it was. A wrong change leaves half-migrated data under a new commit. Proof: `path: tools/team-sim/src/instance/snapshot.test.mjs` assertion `failed migration restores the pre-upgrade clone and previous commit`.
- Replay runs the night's code and keys. A wrong change replays today's planner or a fresh `APP_KEY`, so the hash drifts or sealed data cannot be read. Proof: `path: tools/team-sim/src/replay/replay.test.mjs` assertions `replay uses the recorded commit and env, not the current checkout`, `replay opens the sqlite file in the scratch data dir`, `wgw-sim-replay refuses ~/.wgw-sim/data`.
- The plan for a date is a pure function of world, seed and snapshot. A wrong change makes findings unreplayable. Proof: `path: tools/team-sim/src/planner/planner.test.mjs` assertions `same world, seed and snapshot give the same action-list hash`, `habit actions come from the seed, at most one per persona per night`.
- Bootstrap is idempotent. A wrong change creates duplicate users, Teams or projects every night. Proof: `path: tools/team-sim/src/bootstrap/bootstrap.test.mjs` assertion `second run against the same state plans zero writes`.
- Visibility findings and product pains never leave the machine through the harness. A wrong change files or prints a pre-beta security finding in a public place. Proof: `path: tools/team-sim/src/report/report.test.mjs` assertions `visibility failures render only in the private section`, `product pains render only in the product section`, `flaky failure moves to file-now on the third night`, `report module has no network client`.
- Diaries say only what the run shows. A wrong change lets a diary claim what no action of that persona supports, or lets a logged-out CLI fail the night. Proof: `path: tools/team-sim/src/diary/diary.test.mjs` assertions `naming Google without citing a habit or migration action is an invalid comparison`, `facts hold only the persona's own actions`, `validation drops items that cite someone else's actions and reports bad citations`, `diaries stop at the night's dollar cap`, `an unavailable or logged-out CLI skips the diaries and fails nothing`, `facts leave out outcome notes and anything the harness may have caused`.
- A native client's conflict is not a lost edit. A wrong change either fails every `412` a real client retries, or hides an edit the server dropped. Proof: `path: tools/team-sim/src/actors/api/dav.test.mjs` assertions `a 412 is refetched and retried like the real app`, `an edit lost after the retry fails dav-parity`.
- Each oracle can fail. A wrong change ships an oracle that is green whatever happens. Proof: `path: tools/team-sim/src/oracles/oracles.test.mjs` assertions `every oracle reports a planted fault`, `dev accounts admin and member are known, never personas`, `an admin persona listing every colleague is not a visibility failure`, `an admin persona's DM or share outside his Teams is a visibility failure`.
- The convergence check does not grow with the workspace's age. A wrong change makes month-three nights run past the cap. Proof: `path: tools/team-sim/src/oracles/oracles.test.mjs` assertion `convergence checks touched objects plus a fixed-size sample`.
- A missed night is visible. A wrong change lets the job stop without anyone noticing. Proof: `path: tools/team-sim/src/report/report.test.mjs` assertion `nights without a run are listed`; `path: tools/team-sim/src/schedule/status.test.mjs` assertions `status fails after two days without a night`, `a run after 06:00 is skipped as missed`.
- Nothing in CI or the existing e2e tiers starts the simulation. A wrong change makes a pull-request check boot a 75-minute job. Proof: `cmd: ! grep -rn "team-sim" .github/workflows packages/apps/playwright*.config.* tools/api-e2e/playwright.config.mjs`.
- After `sim-instance` merges alone, `main` still works and no existing command changes. Proof: `cmd: pnpm install --frozen-lockfile && pnpm run check:agent-docs`.

## Chunks

### Chunk A: World and planner

- **id:** `sim-world-planner`
- **Skill:** testing
- **Inputs:** world summary in [spec.md](./spec.md#world-summary); no existing planner. Content corpora are new files.
- **Done when:** `tools/team-sim/world/` holds personas, Teams, clients, projects (phase, start date, staffing) and studio rhythm as JSON; `src/corpus/` holds committed Dutch and English text pools (chat lines, task titles, doc paragraphs, note snippets, file names, including diacritics and emoji); `src/planner/` turns `(world, date, snapshot summary)` into an ordered action list with a stable hash, using a seeded PRNG keyed on the date; each action names the actions it depends on (a reply needs its message, a share needs its file); weekends produce the light plan; sick days and holidays come from the seed; gap moments are actions of kind `gap` with the workaround named; UI rotation picks 3 or 4 personas per night and covers every persona at least once in 7 nights; closing a project deletes its superseded print files, and uploads stop at the 10 GB Drive cap.
- **Verify with:** `pnpm --dir tools/team-sim test -- planner`
- **Parallel with:** `sim-instance`

### Chunk B: Instance manager

- **id:** `sim-instance`
- **Skill:** dev-environment
- **Inputs:** Apache image `path: docker/apache/Dockerfile:1`; Compose services and scheduler `path: compose.dev.yml:42`; upload limits `path: docker/php/uploads.ini:6`; production build and sync `path: packages/apps/package.json:13`; data dir settings `path: packages/api/config/wgw.php:11`; `wgw:dev-install` `path: packages/api/routes/console.php:105`
- **Done when:** `sim up` creates or updates a dedicated worktree at `~/.wgw-sim/checkout` tracking `origin/main`; keeps `WGW_DATA_DIR=./wgw-content` and `WGW_DB_DATABASE=./wgw-content/db.sqlite` in its `packages/api/.env`; starts Docker Desktop if needed (waits up to 3 minutes); runs the `compose.dev.yml` inside that worktree plus `tools/team-sim/compose.sim.yml` with `-p wgw-sim` on `:9290` (through `WGW_DOCKER_HTTP_PORT=9290`, so `web` never also binds `:9080`), which takes the data dir as a parameter (`~/.wgw-sim/data` here) and mounts it at `/var/www/install/wgw-content` on both `web` and `scheduler` (writable by `www-data`), sets `WGW_DISABLE_LOGIN_THROTTLE=1`, caps Apache at 5 request workers, keeps the `scheduler` service and enables `mailhog` with `ports: !override` on host ports taken as parameters (`:2590`/`:2580` here, `:2591`/`:2581` for replay). After every fresh `wgw:dev-install` it sets `APP_URL` to the project's origin. The upgrade follows the order in [spec.md](./spec.md#technical-constraints): stop `web` and `scheduler`, clone a rollback copy with `cp -c`, record the SHA; fast-forward, `pnpm install --frozen-lockfile`, `composer install`, `vite build`, `sync:runtime`, start, `wgw:schema-migrate`; on failure stop, restore the rollback copy, `git reset --hard` to the recorded SHA and report; on success the upgrade ends with the stack up. A separate `snapshot` step (called by `sim night` after reconcile, see Chunk H) stops the writers, clones `~/.wgw-sim/snapshots/<date>/` with a mode-600 `env` copy, writes `meta.json` with the action-list hash the planner computes from that clone, drops the rollback copy, starts the stack and prunes snapshots to 14. `sim down` stops the project. A guard refuses ports taken by anything but its own projects, the dev and PR-test ports, other Compose project names, a compose file outside the sim worktree, a data dir inside any git checkout, and data and snapshot dirs on different volumes.
- **Verify with:** `pnpm --dir tools/team-sim test -- instance`; `node tools/team-sim/bin/sim.mjs up --dry-run`; `node tools/team-sim/bin/sim.mjs up` then `curl -fsS http://127.0.0.1:9290/api/v1/health`
- **Parallel with:** `sim-world-planner`

### Chunk C: World bootstrap and reconcile

- **id:** `sim-bootstrap`
- **Skill:** testing, api
- **Inputs:** admin REST for users and Teams `path: packages/api/routes/api.php:394`; admin role flag `path: packages/api/app/Services/Auth/AdminRoleResolver.php:10`; re-runnable setup pattern `path: packages/apps/e2e/meet-mesh-channel-roster.spec.ts:75`; mail settings `path: packages/api/routes/api.php:405`
- **Done when:** with the dev-install `admin` account as the bootstrap service account, the reconciler reads the current users, Teams and memberships, computes a diff against the world for the night's date (a persona with a later start date is not created yet), and applies only that diff; Maarten is created with `isAdmin: true`; Team `team` from dev-install is left alone; per-project channels, task lists, calendars and Drive folders are created on the project's kick-off date; outgoing mail is set to transport `smtp`, host `mailhog`, port `1025`, security `none` and a fixed dummy username (see [spec.md](./spec.md#technical-constraints) for why each value is needed); the post-night copy reads MailHog's API on that project's published port (`:2580`, replay `:2581`); after the night, the harness copies MailHog's messages into the night's run directory and clears it.
- **Verify with:** `node tools/team-sim/bin/sim.mjs bootstrap` twice on a scratch data dir; the second run plans zero writes.
- **Parallel with:** none

### Chunk D: API actors

- **id:** `sim-api-actors`
- **Skill:** testing, client-transport
- **Inputs:** token login and bearer helper `path: packages/apps/e2e/helpers/live-matrix.ts:28`; JMAP capabilities `path: packages/api/app/Services/Jmap/JmapCapabilities.php:15`; DAV Basic auth `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:26`; seed helpers `path: packages/apps/e2e/helpers/drive-seed.ts:9`; chunked upload `path: .agents/specs/1500-chunked-upload-api/spec.md:10`
- **Done when:** every planner action kind has an API executor: chat message and thread reply, DM, mention; task create, assign, comment, complete, archive; note create and edit; doc create, edit, comment, resolve; calendar event with internal and external invitees, RSVP, reschedule; contact create and edit; Meet scheduled meeting create and channel messages; Drive upload (chunked, generated files of the target size), move, rename, version, delete, share link, guest download. The CalDAV/CardDAV-only persona acts through DAV. Each executor logs request method, matched path, status and timing for the oracles and for coverage. API budget is reset between personas the way the live tier does.
- **Verify with:** `pnpm --dir tools/team-sim test -- actors/api`; one light night on a scratch data dir.
- **Parallel with:** `sim-ui-actors`

### Chunk E: Browser actors

- **id:** `sim-ui-actors`
- **Skill:** testing, workspace
- **Inputs:** per-user browser context `path: packages/apps/e2e/helpers/live-matrix.ts:99`; Meet guest helpers `path: packages/apps/e2e/helpers/meet-guest-chat.ts:106`; fake media flags `path: packages/apps/playwright.live.config.mjs:28`
- **Done when:** the night's UI personas run their actions against the instance's own origin (`:9290`) in their own browser context: chat, Docs co-writing (two personas in the same doc at once), Notes, Tasks, Calendar, Contacts, Drive upload and share dialog, a Meet call with an external guest; the planner gives the night's browser personas at least one action in every app; the offline persona goes offline mid-edit and back; one persona reloads mid-action and one uses a second tab. Console errors, failed requests and visited client routes are captured per context; a trace is kept for each failed action.
- **Verify with:** one night with `--ui-only`; traces under `~/.wgw-sim/runs/<date>/`.
- **Parallel with:** `sim-api-actors`

### Chunk F: Oracles

- **id:** `sim-oracles`
- **Skill:** testing, security
- **Inputs:** oracle table in [spec.md](./spec.md#oracles); Teams visibility rules in `path: .agents/specs/1915-teams-visibility/spec.md:1`; notification inbox `path: packages/api/routes/api.php:170`; actor logs from `sim-api-actors` and `sim-ui-actors`
- **Done when:** after a 5-minute settle window, `convergence` reads each checked object (touched tonight, plus 200 older ones in a seeded rotating order; the report shows the current interval between two checks of the same object) as every persona who can read it and compares normalized state; `errors` reads the API and browser actor logs; `visibility` checks, per persona, list and get calls for objects and colleagues outside their Teams, with `admin` and `member` (Team `team`, dev seed) outside every persona's Teams (private class); an admin persona (Maarten) may find and invite every user by design (`TeamColleagues` returns an unrestricted set for admins), so for him only DMs, shares, presence, free/busy and object reads are checked against his real Teams; `dav-parity` compares DAV and JMAP reads; `upgrade` reads the instance step result; `notify` compares expected entries with each persona's notification inbox (no entry may reach the dev accounts `admin` and `member`); `timing` stores p50/p95 per request kind and flags a jump over the 7-night median; `gap` lists gap actions; `coverage` matches logged requests to OpenAPI path templates and visited routes to client screens, updates `coverage.json` in the data dir, and lists what was not reached in 14 nights. Oracles stop at 15 minutes and mark the rest unchecked. Each oracle has a test that plants a fault and sees it fail.
- **Verify with:** `pnpm --dir tools/team-sim test -- oracles`
- **Parallel with:** none

### Chunk G: Report and replay

- **id:** `sim-report-replay`
- **Skill:** testing, document
- **Inputs:** oracle results from `sim-oracles`; snapshots from `sim-instance`
- **Done when:** `~/.wgw-sim/reports/<date>.md` opens with a three-line plain summary and any missed nights, then failures grouped by oracle with persona, action, trace path and a `sim replay <date> --action <n>` command; visibility failures only in a `Private` section; a known-issues file (`~/.wgw-sim/known-issues.json`) marks repeat failures as `blocked-by #N`; then a `Product` section with gap moments and feature requests, and a `Team voice` section with goals by cost and their 7-night trend, friction items with evidence, time to interactive per screen and the persona diaries (both never filed by triage), then timing trends, coverage gaps and disk growth (the volume's used space). A `flaky` counter per failure signature survives across nights in `~/.wgw-sim/flaky.json`; at 3 the report moves it to "file now". The Sunday-night report adds a weekly digest ranked by frequency and cost, with evidence. `sim replay <date>` follows the replay steps in [spec.md](./spec.md#technical-constraints): a scratch worktree at the SHA in `meta.json`, the snapshot cloned into a scratch data dir, the night's `env` as that worktree's `packages/api/.env` with `APP_URL` set to the replay origin, `wgw-sim-replay` on `:9291` from that worktree with the scratch dir as its data dir parameter, no migrations and no reconcile; planner and actors run from that worktree, and the action-list hash must match `meta.json`.
- **Verify with:** `pnpm --dir tools/team-sim test -- report replay`; `node tools/team-sim/bin/sim.mjs replay <date>` on a recorded night after `main` has moved.
- **Parallel with:** none

### Chunk H: Schedule, status and triage skill

- **id:** `sim-schedule-skill`
- **Skill:** dev-environment, document
- **Inputs:** the night command from `sim-report-replay`
- **Done when:** `sim schedule install` writes a launchd agent that runs `sim night` at 01:00 with `nice`, a 75-minute cap and a log file, and prints the one `sudo pmset repeat wakeorpoweron` line for the maintainer; `sim schedule uninstall` removes it; `sim night` runs the whole night in this order: upgrade with rollback, reconcile (a failure rolls back like a failed upgrade), snapshot and plan, actors, settle, oracles, report; a start after 06:00 skips all of it and records the night as missed; `sim status` prints the last completed night and exits non-zero after two days without one; `.agents/skills/testing/team-simulation.md` explains install, status, a manual night, replay, how to triage the morning report (reproduced bugs filed directly with the `team-sim` label, in user terms, after a duplicate search; a known bug gets a comment only when the simulation adds new information; flaky failures after three nights; the private section only through the advisory process; the `Product` and `Team voice` sections and the weekly digest go to the product lead, never filed by triage), how to add to the known-issues file, `sim diary <date>` and `--no-diary`, that diaries need a logged-in `claude` CLI, and that the triage after the third night records the phase 2 decision on #1981.
- **Verify with:** `node tools/team-sim/bin/sim.mjs schedule install --dry-run`; `pnpm --dir tools/team-sim test -- schedule`; `pnpm run check:agent-docs`
- **Parallel with:** none

### Chunk I: Moved from Google Workspace

- **id:** `sim-habits`
- **Skill:** testing, workspace
- **Inputs:** `sim-world-planner`, `sim-api-actors`, `sim-ui-actors`, and the friction and diary steps of the report
- **Done when:** `world/habits.json` holds the Google habit catalog and `world/takeout/` the fixture export in [spec.md](./spec.md#moved-from-google-workspace); the planner draws four to six habit actions a night (at most one per persona, on a layer the habit runs on) and two to four `migrate.import` actions on weekdays from the seed, and the action-list hash stays a pure function of world, seed and snapshot; each habit has an API or browser flow that records `habit: ok` or a friction record with source `habit` and the habit id, then finishes the goal with the workaround; each import type goes through the suite's own import path and is checked field by field, lost content failing and a missing path recorded as friction with source `migration`; `sim night --habits all` plans every habit and import type once for a check night; the `Team voice` section has a `Since Google` table and the weekly digest groups friction by habit and import type; diary facts carry the move and a sentence that names Google, Gmail, Sheets or Takeout without citing a habit or migration action counts as an invalid comparison.
- **Verify with:** `pnpm --dir tools/team-sim test -- planner friction diary`; `node tools/team-sim/bin/sim.mjs night --minutes 25 --habits all` runs every habit and import type, and the report's `Since Google` table lists each one.
- **Parallel with:** none

### Chunk J: Devices and native apps

- **id:** `sim-devices`
- **Skill:** testing, workspace, client-transport
- **Inputs:** `sim-api-actors` (the DAV executors), `sim-ui-actors`, `sim-oracles` (`dav-parity`), `sim-habits`
- **Done when:** `world/personas.json` has a device profile per persona as in [spec.md](./spec.md#devices-and-native-apps); browser actions run on the desk or, for a seeded share, in WebKit with iPhone emulation or Chromium with Android emulation; each native app has a client actor that keeps a local copy, syncs with `sync-collection` or the collection tag, pushes with `If-Match`, retries a `412` like the real app and queues offline edits; `world/dav-dialects/` holds Apple fixtures recorded from the real apps (made fictional) and DAVx5 fixtures marked not recorded; `dav-parity` checks both directions and round trips for events, contacts and tasks; device friction is recorded with source `device`; the `Team voice` section has a table per device and app; diary facts carry the device.
- **Verify with:** `pnpm --dir tools/team-sim test -- actors/api oracles planner`; one shortened night in which every native app and both phone types ran, with `dav-parity` passing or each failure traced to a request.
- **Parallel with:** none

### Chunk V: Cross-chunk verify

- **id:** `sim-verify`
- **Skill:** testing
- **Inputs:** all chunks merged
- **Done when:** a read-only verifier from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md) returns `PASS` or `PASS_WITH_NITS`; three consecutive unattended nights complete on the maintainer's Mac and their reports are triaged; the phase 2 decision (which of fault injection, shrinking and coverage steering get an issue, and why) is recorded as a comment on #1981.
- **Verify with:** the three morning reports, the verifier output and the decision comment.
- **Parallel with:** none

## Phase 2 (not in this plan)

Designed in [spec.md](./spec.md#phase-2-decided-after-three-nights); each part chosen after three nights gets its own issue, spec and plan. Known inputs for those plans: Playwright's clock API (`page.clock`) for `clock-skew`; the Compose `web` service for `api-restart` (`path: compose.dev.yml:18`); dependency edges from `sim-world-planner`; `coverage.json` from `sim-oracles`. A coverage-steering plan changes the planner and must keep the determinism invariant by reading coverage only from the snapshot.

## Test plan

- [ ] Unit (node:test or Vitest in `tools/team-sim`): planner determinism, guard, data mount, snapshot clones with the stack stopped, upgrade rollback, replay on the recorded commit and env, bootstrap diff, oracle planted faults, convergence sample bound, coverage matching, report sections, missed-night status, friction chains, metrics and trend, diary validation and caps, digest ranking, habit and import drawing, habit outcomes, import field checks and the comparison check, native client sync (local copy, sync token, `412` retry, offline queue) against recorded dialects.
- [ ] One manual light night on a scratch data directory, then a replay of it with a matching action-list hash after `main` has moved.
- [ ] One forced failed migration on a scratch instance: the data dir and worktree are back on the previous night's state.
- [ ] Three consecutive unattended nights on the maintainer's Mac before the issue closes; the morning reports are read and triaged, and the phase 2 decision is recorded.

## Doc updates (only if user wants)

- `.agents/skills/testing/team-simulation.md`: how to install, run, replay, check status, and triage (part of `sim-schedule-skill`).
