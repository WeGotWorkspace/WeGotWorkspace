# Nightly team simulation

Derived from [spec.md](./spec.md). Delivery issue [#1981](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1981) (Chore).

## Goal

A local, unattended night job plays a fictional 10-person agency against a long-lived instance on `main`, then checks cross-app, cross-user and cross-time invariants and writes a private morning report. The engine is deterministic per date so every finding can be replayed.

## Budget

Draws from hardening (Technical debt and Pioneer bug flow). Displaces nothing on a product milestone: no UI, no API change. Machine cost: one hour of the maintainer's Mac per night and up to 50 GB of disk.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The live tier boots the API through `dev-php-server.sh`, which runs `wgw:schema-migrate` and then `php -S` on a hard-coded `:9080` from the repository's own `.env`. The harness cannot reuse the script for its own ports and data. `path: packages/api/scripts/dev-php-server.sh:23`
- Live specs run from `playwright.live.config.mjs` with one worker and `WGW_DISABLE_LOGIN_THROTTLE=1` on the API server. `path: packages/apps/playwright.live.config.mjs:13`
- `wgw:dev-install` creates the `.env` keys, SQLite, an `admin` and a `member` account, idempotently; seed commands are allowed only in a local monorepo checkout. `path: packages/api/routes/console.php:105`; `path: packages/api/app/Services/Installer/DevSeedGuard.php:16`
- No artisan command creates an arbitrary user or group. Users and Teams are created through the admin REST API (`POST admin/users`, `POST admin/groups`, `PUT admin/groups/{group}/members/{username}`). `path: packages/api/routes/api.php:394`; `path: packages/api/app/Http/Requests/Api/V1/AdminUserCreateRequest.php:25`
- The admin role today is membership of `principals/groups/administrators`. `path: packages/api/app/Services/Auth/AdminRoleResolver.php:11`
- Login is `POST /api/v1/auth/token` returning a bearer JWT plus a `wgw_refresh` cookie; there are no personal access tokens. API actors log in like the web app. `path: packages/api/routes/api.php:90`
- Reusable multi-user helpers exist: token login with 429 retry, bearer `api(user, method, path)`, and `openUser(browser, user)` giving each user an isolated browser context. `path: packages/apps/e2e/helpers/live-matrix.ts:28`; `path: packages/apps/e2e/helpers/live-matrix.ts:99`
- A re-runnable user, Team and channel setup that accepts "already exists" is in a live spec. `path: packages/apps/e2e/meet-mesh-channel-roster.spec.ts:75`
- Per-app seed helpers: Drive `putDriveFile` `path: packages/apps/e2e/helpers/drive-seed.ts:9`, Docs `seedDocAtPath` `path: packages/apps/e2e/helpers/docs-live.ts:150`, Calendar `createUtcCalendarEventViaApi` `path: packages/apps/e2e/helpers/calendar-live.ts:147`, Meet guest `openGuest` / `knockAsGuest` `path: packages/apps/e2e/helpers/meet-guest-chat.ts:106`.
- The per-account API budget is 600 requests a minute; live specs reset it with `wgw:e2e-reset-api-budget`. `path: packages/api/app/Http/RateLimiting/WgwApiRateLimiters.php:38`; `path: packages/apps/e2e/helpers/live-test.ts:34`
- JMAP capabilities cover calendars, contacts, file nodes, notes, chat and availability; Tasks has its own capability. There is no JMAP mail capability. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:15`; `path: packages/api/app/Services/Tasks/TasksCapabilitiesService.php:24`
- CalDAV/CardDAV is served at the root with Basic auth. `path: packages/api/routes/web.php:55`; `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:26`
- Data directory and SQLite path come from `WGW_DATA_DIR` and `WGW_DB_DATABASE`. `path: packages/api/config/wgw.php:11`; `path: packages/api/.env.example:101`
- App mail (calendar invites, share mail) goes through `MailDeliveryService` with the instance's SMTP settings, not Laravel's `MAIL_MAILER`; the settings are written through `PUT admin/settings`. `path: packages/api/app/Services/MailDelivery/MailDeliveryService.php:37`; `path: packages/api/routes/api.php:405`
- Guests reach Meet rooms, share sessions and download tickets without an account. `path: packages/api/routes/api.php:118`; `path: packages/api/routes/api.php:390`
- The nightly CI job runs the live, chaos and relay suites on a fresh database and opens a public issue on failure. `path: .github/workflows/nightly-live-e2e.yml:94`; `path: .github/workflows/nightly-live-e2e.yml:222`
- The preview and dev servers read the API proxy target from `WGW_PROXY_TARGET`, so a fault proxy can sit between them and the API. `path: packages/apps/scripts/wgw-proxy-target.ts:16`
- The OpenAPI contract lists every REST path template for coverage matching. `path: packages/api/openapi/openapi.json:1`
- Playwright `^1.64` is in use; its clock API can run one browser context's time off. `path: packages/apps/package.json:108`
- Drive quota is exposed through the JMAP quota capability. `path: packages/api/app/Services/Jmap/JmapCapabilities.php:27`
- `tools/api-e2e` is the precedent for a Playwright workspace package under `tools/`. `path: pnpm-workspace.yaml:5`

## Considered

Considered: extending the existing live tier (`packages/apps/e2e`, run by `nightly-live-e2e.yml`) with long multi-user specs, versus a separate harness. Rejected extending it: the live tier boots a fresh database per run and each spec owns its fixture users, so nothing ages, and its results land in public CI logs. The harness reuses the live tier's helpers and boot knowledge instead of copying them.

Considered: GitHub Actions (free for this public repository) as the runner. Rejected for now: logs, traces and auto-filed issues are public, which conflicts with keeping visibility findings private before beta, and every run starts from an empty database. The engine stays machine-independent so the non-visibility oracles can move to CI later.

Considered: LLM-driven personas that decide each click. Rejected: costly per night, not replayable, and a failure cannot be told apart from a confused agent. The LLM stays outside the loop: corpora are written once and committed; triage of the morning report is done by a maintainer or an agent session.

Considered: faking the server clock to run a month in one night. Rejected: the server, CalDAV clients, push and browser all read real time, and a faked clock tests a state no user reaches. Real time also makes the workspace age the way a customer's does.

Considered: letting the harness file Bugs itself from oracle failures. Rejected: a failure that does not reproduce on replay would become a public issue, duplicates would pile up night after night, and a visibility finding could slip into a public body. Triage files reproduced bugs directly; the harness only writes the report.

Considered: shrinking by bisecting the night (replay the first half, then the first quarter), versus delta debugging with dependency edges. Rejected plain bisection: most failures need an early setup action plus a late trigger, and bisecting the prefix keeps everything in between. ddmin removes unrelated actions anywhere; the dependency edges keep candidates valid.

Considered: fault injection inside the API (a test-only middleware), versus outside it (process restart, proxy, browser clock, real quota). Rejected the middleware: it adds a test path to production code, which the non-goals rule out, and outside faults are what users hit.

Considered: coverage from PHP code coverage (Xdebug or PCOV), versus route and screen coverage. Rejected code coverage for nightly use: it slows the API several times over and distorts the timing oracle. Route and screen coverage comes from logs the harness already keeps.

Considered: one fresh world per night (seed, act, discard). Rejected: it removes the aged-data and upgrade-on-old-data coverage that is the main reason for the harness.

## Affected packages

- tools/team-sim (new workspace package `@wgw/team-sim`)
- .agents/skills/testing (one page)
- pnpm-workspace.yaml (one line)

## Dependencies

1. `sim-world-planner` and `sim-instance` in parallel.
2. `sim-bootstrap` after `sim-instance`.
3. `sim-api-actors` and `sim-ui-actors` after `sim-world-planner` and `sim-bootstrap`; in parallel with each other.
4. `sim-oracles` after `sim-api-actors` (oracles read through the same API client).
5. `sim-report-replay` after `sim-oracles`.
6. `sim-faults` after `sim-instance`, `sim-api-actors` and `sim-ui-actors`; in parallel with `sim-oracles`.
7. `sim-shrink` after `sim-report-replay`.
8. `sim-coverage` after `sim-report-replay`; in parallel with `sim-shrink`.
9. `sim-schedule-skill` after `sim-shrink`, `sim-coverage` and `sim-faults`.
10. `sim-verify` last.

## Open decisions

None — every choice is made. Choices made without a separate review: ports `:9290`/`:4290`; data under `~/.wgw-sim/`; night slot 01:00–02:15 local time via launchd with a `pmset` wake one minute earlier (installed once by the maintainer, it needs `sudo`); 14 snapshots kept; Drive volume cap 50 GB; weekend nights run the light plan; at most one fault window per 10 simulated minutes; shrink time box 30 minutes per failure and 3 failures per morning; coverage horizon 14 nights.

## Invariants

- The harness never touches the dev or PR-test instance. A wrong change writes simulation data into the maintainer's dev database or kills a PR test server. Proof: `path: tools/team-sim/src/instance/guard.test.mjs` assertions `refuses a taken port`, `refuses a data dir inside a git checkout`, `refuses the dev and PR-test ports`.
- The plan for a date is a pure function of world, seed and snapshot. A wrong change makes findings unreplayable. Proof: `path: tools/team-sim/src/planner/planner.test.mjs` assertion `same world, seed and snapshot give the same action-list hash`.
- Bootstrap is idempotent. A wrong change creates duplicate users, Teams or projects every night. Proof: `path: tools/team-sim/src/bootstrap/bootstrap.test.mjs` assertion `second run against the same state plans zero writes`.
- Visibility findings and product pains never leave the machine through the harness. A wrong change files or prints a pre-beta security finding in a public place. Proof: `path: tools/team-sim/src/report/report.test.mjs` assertions `visibility failures render only in the private section`, `product pains render only in the product section`, `flaky failure moves to file-now on the third night`, `report module has no network client`.
- Each oracle can fail. A wrong change ships an oracle that is green whatever happens. Proof: `path: tools/team-sim/src/oracles/oracles.test.mjs` assertion `every oracle reports a planted fault`.
- An injected fault never counts as a bug by itself, and never hides one. A wrong change floods the report with expected 502s, or lets a lost write inside a fault window pass. Proof: `path: tools/team-sim/src/oracles/faults.test.mjs` assertions `a 502 inside a net window is ignored by errors`, `a write lost inside a fault window still fails convergence`.
- A shrunk sequence still fails and never drops a prerequisite. A wrong change files a bug with steps that do not reproduce. Proof: `path: tools/team-sim/src/shrink/shrink.test.mjs` assertions `ddmin keeps the failing property on a planted fault`, `a candidate never drops a dependency of a kept action`.
- Coverage steering does not break determinism. A wrong change makes replay differ because coverage was read from outside the snapshot. Proof: `path: tools/team-sim/src/planner/planner.test.mjs` assertion `coverage is read from the snapshot and changes the plan only through it`.
- Nothing in CI or the existing e2e tiers starts the simulation. A wrong change makes a pull-request check boot a 75-minute job. Proof: `cmd: ! grep -rn "team-sim" .github/workflows packages/apps/playwright*.config.* tools/api-e2e/playwright.config.mjs`.
- After `sim-instance` merges alone, `main` still works and no existing command changes. Proof: `cmd: pnpm install --frozen-lockfile && pnpm run check:agent-docs`.

## Chunks

### Chunk A: World and planner

- **id:** `sim-world-planner`
- **Skill:** testing
- **Inputs:** world summary in [spec.md](./spec.md#world-summary); no existing planner. Content corpora are new files.
- **Done when:** `tools/team-sim/world/` holds personas, Teams, clients, projects (phase, start date, staffing) and studio rhythm as JSON; `src/corpus/` holds committed Dutch and English text pools (chat lines, task titles, doc paragraphs, note snippets, file names, including diacritics and emoji); `src/planner/` turns `(world, date, snapshot summary)` into an ordered action list with a stable hash, using a seeded PRNG keyed on the date; weekends produce the light plan; sick days and holidays come from the seed; gap moments are actions of kind `gap` with the workaround named; UI rotation picks 3 or 4 personas per night and covers every persona at least once in 7 nights.
- **Verify with:** `pnpm --dir tools/team-sim test -- planner`
- **Parallel with:** `sim-instance`

### Chunk B: Instance manager

- **id:** `sim-instance`
- **Skill:** dev-environment
- **Inputs:** hard-coded `:9080` in `path: packages/api/scripts/dev-php-server.sh:31`; data dir settings `path: packages/api/config/wgw.php:11`; `wgw:dev-install` `path: packages/api/routes/console.php:105`
- **Done when:** `sim up` creates or updates a dedicated worktree at `~/.wgw-sim/checkout` tracking `origin/main`; writes its `packages/api/.env` with `WGW_DATA_DIR` and `WGW_DB_DATABASE` under `~/.wgw-sim/data`; runs `pnpm install --frozen-lockfile`, `composer install`, the production build and `wgw:schema-migrate`; starts `php -S 127.0.0.1:9290` with `WGW_DISABLE_LOGIN_THROTTLE=1` and `vite preview` on `:4290` proxying to it; records the commit; copies the data dir to `~/.wgw-sim/snapshots/<date>/` before the night and prunes to 14. `sim down` stops both servers. A guard refuses taken ports, the dev and PR-test ports, and a data dir inside any git checkout.
- **Verify with:** `pnpm --dir tools/team-sim test -- instance`; `node tools/team-sim/bin/sim.mjs up --dry-run`
- **Parallel with:** `sim-world-planner`

### Chunk C: World bootstrap and reconcile

- **id:** `sim-bootstrap`
- **Skill:** testing, api
- **Inputs:** admin REST for users and Teams `path: packages/api/routes/api.php:394`; admin group `path: packages/api/app/Services/Auth/AdminRoleResolver.php:11`; re-runnable setup pattern `path: packages/apps/e2e/meet-mesh-channel-roster.spec.ts:75`; mail settings `path: packages/api/routes/api.php:405`
- **Done when:** with the dev-install `admin` account as the bootstrap service account, the reconciler reads the current users, Teams and memberships, computes a diff against the world for the night's date (a persona with a later start date is not created yet), and applies only that diff; Maarten joins the admin group (and the admin role once #1925 lands); per-project channels, task lists, calendars and Drive folders are created on the project's kick-off date; outgoing mail is pointed at a local SMTP sink started by the harness on `127.0.0.1:2590`, which stores messages under the night's run directory.
- **Verify with:** `node tools/team-sim/bin/sim.mjs bootstrap` twice on a scratch data dir; the second run plans zero writes.
- **Parallel with:** none

### Chunk D: API actors

- **id:** `sim-api-actors`
- **Skill:** testing, client-transport
- **Inputs:** token login and bearer helper `path: packages/apps/e2e/helpers/live-matrix.ts:28`; JMAP capabilities `path: packages/api/app/Services/Jmap/JmapCapabilities.php:15`; DAV Basic auth `path: packages/api/app/Dav/Auth/SabrePdoBasicAndCookieAuth.php:26`; seed helpers `path: packages/apps/e2e/helpers/drive-seed.ts:9`
- **Done when:** every planner action kind has an API executor: chat message and thread reply, DM, mention; task create, assign, comment, complete, archive; note create and edit; doc create, edit, comment, resolve; calendar event with internal and external invitees, RSVP, reschedule; contact create and edit; Drive upload (chunked, generated files of the target size), move, rename, version, share link, guest download. The CalDAV/CardDAV-only persona acts through DAV. Each executor logs request kind, status and timing for the oracles. API budget is reset between personas the way the live tier does.
- **Verify with:** `pnpm --dir tools/team-sim test -- actors/api`; one light night on a scratch data dir.
- **Parallel with:** `sim-ui-actors`

### Chunk E: Browser actors

- **id:** `sim-ui-actors`
- **Skill:** testing, workspace
- **Inputs:** per-user browser context `path: packages/apps/e2e/helpers/live-matrix.ts:99`; Meet guest helpers `path: packages/apps/e2e/helpers/meet-guest-chat.ts:106`; fake media flags `path: packages/apps/playwright.live.config.mjs:28`
- **Done when:** the night's UI personas run their actions through the production preview in their own browser context: chat, Docs co-writing (two personas in the same doc at once), Notes, Tasks, Calendar, Drive upload and share dialog, a Meet call with an external guest; the offline persona goes offline mid-edit and back; one persona reloads mid-action and one uses a second tab. Console errors and failed requests are captured per context; a trace is kept for each failed action.
- **Verify with:** one night with `--ui-only`; traces under `~/.wgw-sim/runs/<date>/`.
- **Parallel with:** `sim-api-actors`

### Chunk F: Oracles

- **id:** `sim-oracles`
- **Skill:** testing, security
- **Inputs:** oracle table in [spec.md](./spec.md#oracles); Teams visibility rules in `path: .agents/specs/1915-teams-visibility/spec.md:1`
- **Done when:** after a settle window, `convergence` reads each shared object as every persona who can read it and compares normalized state; `errors` reads the actor logs; `visibility` checks, per persona, list and get calls for objects and colleagues outside their Teams (private class); `dav-parity` compares DAV and JMAP reads; `upgrade` reads the instance step result; `notify` compares expected and received notifications; `timing` stores p50/p95 per request kind and flags a jump over the 7-night median; `gap` lists gap actions. Each oracle has a test that plants a fault and sees it fail.
- **Verify with:** `pnpm --dir tools/team-sim test -- oracles`
- **Parallel with:** none

### Chunk G: Report and replay

- **id:** `sim-report-replay`
- **Skill:** testing, document
- **Inputs:** oracle results from `sim-oracles`; snapshots from `sim-instance`
- **Done when:** `~/.wgw-sim/reports/<date>.md` opens with a three-line plain summary, then failures grouped by oracle with persona, action, trace path and a `sim replay <date> --action <n>` command; visibility failures only in a `Private` section; a known-issues file (`~/.wgw-sim/known-issues.json`) marks repeat failures as `blocked-by #N`; then a `Product` section with gap moments, friction and feature requests (never filed by triage), then timing trends. A `flaky` counter per failure signature survives across nights in `~/.wgw-sim/flaky.json`; at 3 the report moves it to "file now". The Sunday-night report adds a weekly product digest ranked by frequency. `sim replay <date>` restores the snapshot into a scratch data dir on `:9291`/`:4291` and reruns the plan; the action-list hash must match.
- **Verify with:** `pnpm --dir tools/team-sim test -- report`; `node tools/team-sim/bin/sim.mjs replay <date>` on a recorded night.
- **Parallel with:** none

### Chunk I: Fault injection

- **id:** `sim-faults`
- **Skill:** testing, dev-environment
- **Inputs:** proxy target setting `path: packages/apps/scripts/wgw-proxy-target.ts:16`; quota capability `path: packages/api/app/Services/Jmap/JmapCapabilities.php:27`; Playwright version `path: packages/apps/package.json:108`
- **Done when:** the planner emits fault actions from the seed within the window budget; `src/faults/` runs a small Node fault proxy on `:9292` (latency, connection drop, 502) that the preview server targets during the night; `api-restart` stops and restarts the PHP server through the instance manager; `clock-skew` installs the Playwright clock on one UI persona's context; `quota` sets the persona's Drive quota through the admin API before an upload round and restores it after; every fault writes start and end to the night log, which the oracles read.
- **Verify with:** `pnpm --dir tools/team-sim test -- faults`; one light night with `--faults-only` shows each fault kind in the log.
- **Parallel with:** `sim-oracles`

### Chunk J: Shrinking

- **id:** `sim-shrink`
- **Skill:** testing
- **Inputs:** replay from `sim-report-replay`; dependency edges from `sim-world-planner`
- **Done when:** `sim shrink <date> --action <n>` runs ddmin over the action prefix on scratch copies of the snapshot, keeps dependency closure, stops at the 30-minute box, and writes the shortest failing sequence in user terms into the report next to the failure; the morning triage shrinks at most 3 failures.
- **Verify with:** `pnpm --dir tools/team-sim test -- shrink`; shrink a planted failure on a recorded night to at most 5 actions.
- **Parallel with:** `sim-coverage`

### Chunk K: Coverage steering

- **id:** `sim-coverage`
- **Skill:** testing
- **Inputs:** OpenAPI path templates `path: packages/api/openapi/openapi.json:1`; actor request logs from `sim-api-actors` and `sim-ui-actors`
- **Done when:** after each night, request logs are matched to OpenAPI path templates and UI navigation to client route paths; `coverage.json` in the data directory stores last-reached dates; the planner weights free choices by days since last reached; the report lists paths and screens not reached in 14 nights.
- **Verify with:** `pnpm --dir tools/team-sim test -- coverage`; two consecutive planned nights differ in free choices toward unreached items.
- **Parallel with:** `sim-shrink`

### Chunk H: Schedule and triage skill

- **id:** `sim-schedule-skill`
- **Skill:** dev-environment, document
- **Inputs:** the night command from `sim-report-replay`
- **Done when:** `sim schedule install` writes a launchd agent that runs `sim night` at 01:00 with `nice`, a 75-minute cap and a log file, and prints the one `sudo pmset repeat wakeorpoweron` line for the maintainer; `sim schedule uninstall` removes it; `.agents/skills/testing/team-simulation.md` explains install, a manual night, replay, how to triage the morning report (reproduced bugs filed directly with the `team-sim` label, in user terms, after a duplicate search; flaky failures after three nights; the private section only through the advisory process; the `Product` section and the weekly digest go to the product lead, never filed by triage), and how to add to the known-issues file.
- **Verify with:** `node tools/team-sim/bin/sim.mjs schedule install --dry-run`; `pnpm run check:agent-docs`
- **Parallel with:** none

### Chunk V: Cross-chunk verify

- **id:** `sim-verify`
- **Skill:** testing
- **Inputs:** all chunks merged
- **Done when:** a read-only verifier from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md) returns `PASS` or `PASS_WITH_NITS`; three consecutive unattended nights complete on the maintainer's Mac and their reports are triaged.
- **Verify with:** the three morning reports and the verifier output.
- **Parallel with:** none

## Test plan

- [ ] Unit (node:test or Vitest in `tools/team-sim`): planner determinism, guard, bootstrap diff, oracle planted faults, report sections, fault windows, ddmin, coverage matching.
- [ ] One manual light night on a scratch data directory, then a replay of it with a matching action-list hash.
- [ ] Three consecutive unattended nights on the maintainer's Mac before the issue closes; the morning reports are read and triaged.

## Doc updates (only if user wants)

- `.agents/skills/testing/team-simulation.md`: how to install, run, replay, and triage (part of `sim-schedule-skill`).
