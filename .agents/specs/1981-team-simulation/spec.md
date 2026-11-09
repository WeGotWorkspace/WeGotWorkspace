Source: #1981 (body-hash: 210fefe2)

# Nightly team simulation

Technical translation of [#1981](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1981). The issue is the record for acceptance criteria. Chunks and proofs are in [plan.md](./plan.md).

## Goal

A deterministic harness under `tools/team-sim/` plays a fictional 10-person creative agency ("Studio Kade") that uses the whole suite every night for about an hour, against a long-lived local instance whose data persists across nights. After each night, oracles check invariants that span apps, users and time, and write a private morning report. A maintainer or an agent session triages the report. The harness is a hardening tool: it finds bugs between apps, in aged data, and across upgrades, which the per-feature e2e specs do not reach.

## Non-goals

- No product feature, no UI, no change to the API contract. If an oracle needs data the API does not expose, that is a finding, not a reason to add a test-only endpoint.
- No LLM at run time. Content (messages, doc text, task titles) comes from committed Dutch/English corpora; the planner is plain code with a seeded PRNG.
- No GitHub Actions run in this issue. Planner, actors and oracles have no macOS-only code; only the scheduler (launchd) is Mac-specific, so the engine can move to an always-on machine or a self-hosted runner later.
- No simulation of outside tools (accounting, Figma, time tracking, password manager, spreadsheets). A persona that needs one logs a gap moment.
- No load test. Ten personas and one hour a night is realistic team volume, not stress volume.
- No Mail app actions. Mail is IMAP-backed and has no JMAP capability, so it needs an IMAP server next to the instance; that is a follow-up once the harness runs.
- No Web Push. The `notify` oracle reads the notification inbox; push subscriptions need an outside push service and are left out.
- No mail delivery to the outside world. External client addresses use a reserved domain (`example.org`) and outgoing mail stays local.
- Phase 2 (fault injection, shrinking, coverage steering) is designed below but not built in this issue. See [Phase 2](#phase-2-decided-after-three-nights).

## Affected packages

- `tools/team-sim/` (new): world, planner, actors, oracles, report, instance manager, scheduler install
- `packages/apps/e2e/helpers/` (read-only reuse; no change unless a helper needs exporting)
- `.agents/skills/testing/` (one page on running and triaging the simulation)

## Technical constraints

- **Isolation.** Own git worktree that tracks `origin/main`, own port (`:9290`), own Docker Compose project (`wgw-sim`), own data directory outside the repository (`~/.wgw-sim/`). The harness refuses to start when a port is taken or the data directory resolves inside a repository checkout. Dev (`:9080/:5173/:4173`) and the PR test worktree (`:9090/:5190/:4190`) are never touched.
- **Shared-host stack.** The instance runs on the repository's Apache + mod_php image (`docker/apache`), with the shared-host upload limits (`docker/php/uploads.ini`), `.htaccess` applied, Apache capped at 5 request workers (the shared-host worker budget the live-updates spec assumes), and the `scheduler` service running `schedule:run` every minute like a host's cron. The production build is synced into the install root, so browser actors and the API share one origin, as in production. Docker Desktop must be running; the night starts it and waits up to 3 minutes, otherwise it ends with a report and no actions.
- **Real time.** The server clock is not faked. The night run starts at 01:00 on date D and simulates the working day D. Weekdays run the full day plan; Saturday and Sunday run a light plan. The world's calendar is anchored to real dates.
- **Determinism.** The plan for a night is a pure function of `(world, seed = run date, snapshot of the data)`. The engine reads the server state once at the start of the night, then derives all actions from the seed. Wall-clock timing, network jitter and browser rendering are allowed to differ between replays; the action list is not.
- **Snapshots.** Before each night the data directory is cloned to `~/.wgw-sim/snapshots/<date>/` with APFS clonefile (`cp -c`), and 14 are kept. Clones share unchanged blocks, so a snapshot costs only what changed since the last one. Clonefile works only within one volume: the harness refuses to start when the data and snapshot directories are on different volumes. `replay <date>` clones that snapshot into a scratch data directory and reruns the plan on a second Compose project (`wgw-sim-replay`, `:9291`).
- **Upgrades.** Each night first fast-forwards the worktree to `origin/main`, installs dependencies, builds the production bundle, rebuilds the image when its Dockerfile changed, runs migrations on the persistent database, and records the commit. A failed migration or build ends the night with a report and no actions.
- **Auth.** Personas log in the way users do. Browser actors use the login page. API actors use the same session or token flow the web app uses; no test-only auth path.
- **Two actor layers.** Each night 3 to 4 personas act through Playwright browser contexts (rotation from the seed, every persona at least once a week); the rest act through REST, JMAP, CalDAV/CardDAV. One persona always uses CalDAV/CardDAV only (the "desktop calendar app" trait).
- **Outgoing mail** (calendar invites to external clients, share notifications) goes to a local SMTP sink the harness starts on the host, set through the instance's admin mail settings. Nothing is sent. The oracles read the capture.
- **Bootstrap account.** The `admin` account that `wgw:dev-install` creates is the harness's service account for creating users and Teams. It is not a persona and does not act during the night.
- **Findings policy.** The harness never files issues; it writes the report. Triage the same morning:
  - A bug that reproduces on replay is filed directly as a public Bug (normal filing rules, label `team-sim`), in user terms with the fictional names, without instance address or replay data. Duplicates are checked first.
  - A failure that does not reproduce stays in the report as `flaky` with a night counter; it is filed once the counter reaches 3.
  - Oracle failures in the `visibility` class, and anything the security skill treats as a security finding, stay in the private section and go through the advisory process (pre-beta: fix and close, never publish).
  - Product pains (gap moments, friction) and feature requests stay in the private report. The Sunday-night report adds a weekly digest ranked by frequency. Only the product lead turns one into a Goal.
- **Coverage recording.** Each night records which API routes (request method and path matched to an OpenAPI path template) and which app screens (client route paths) were reached, in a cumulative `coverage.json` in the data directory. The report lists what was not reached in 14 nights. In this issue coverage is only recorded and reported; the planner does not read it.
- **Missed nights.** The night writes `~/.wgw-sim/last-night.json` when it ends. `sim status` exits non-zero when no night completed in the last 2 days, and the next report lists the nights that did not run. A launchd run that starts after 06:00 (the Mac woke late) skips the night and logs it as missed instead of acting during the maintainer's day.
- **Resource use.** The night runs at a fixed slot with lowered priority and a hard time cap of 75 minutes: about 55 minutes of actions, 5 minutes of settle, and at most 15 minutes of oracles. It must not overlap another night job of the maintainer on the same ports or data.

## World (summary)

Full data lives in `tools/team-sim/world/`. Names are fictional.

| Persona | Role | Trait under test |
|---|---|---|
| Maarten | Sales, founder, admin | Offline on the road; edits queue up and sync later |
| Priya | Sales | Runs intakes with external client guests in Meet |
| Joost | Project manager | Uses CalDAV/CardDAV only, never the web calendar |
| Sanne | Project manager | Runs three projects; heavy calendar and task user |
| Lotte | Strategist | Four-day week (Wednesday off); availability conflicts |
| Bas | Strategist | One month in Europe/Lisbon; time zone handling |
| Fatima | Copywriter | Co-writes in Docs with others at the same time |
| Tom | Copywriter | Joins in week 4; onboarding into Teams with history |
| Eva | Art director | Uploads large print files (100 MB to 1 GB PDFs, packages) through chunked upload |
| Daan | Digital designer | Shares exports with clients by link; version rounds |

Teams: `Studio` (all, projects as filters), `Business` (sales and project managers; private pipeline), one confidential client team. Clients are external contacts without accounts: they join Meet as guests, receive share links and calendar invites by mail.

Project phases and the suite surfaces they exercise:

| Phase | Surfaces |
|---|---|
| Intake | Contacts, Calendar invite to external, Meet with guest, Docs proposal |
| Kick-off | Teams/Projects, Tasks list, chat channel, Calendar milestones, Drive folder tree |
| Strategy | Meet workshops, Notes, Docs co-writing, comments and threads |
| Design | Drive large uploads, versions, feedback in Docs threads and chat |
| Production | Drive print files, share links to clients, guest downloads |
| Close | Archive tasks, notes and folders; delete superseded print files; leave project channel |

Studio rhythm: Monday studio meeting, daily project stand-up, Friday deadlines, sick days and holidays from the seed, sales booking a kick-off while the team is full.

## Oracles

| Class | Invariant |
|---|---|
| `convergence` | After sync settles, every persona that can read a checked object (doc, note, task, event, file, message) sees the same state. Checked objects are those touched that night plus a seeded rotating sample of 200 older ones, so every object is checked within a bounded number of nights and the oracle's cost does not grow with the workspace's age |
| `errors` | No 5xx response and no uncaught console error during the night |
| `visibility` | A persona never lists, opens or reaches an object or colleague their Teams do not grant (private) |
| `dav-parity` | CalDAV/CardDAV reads match JMAP/REST reads for the same calendars and address books |
| `upgrade` | Build and migrations on the aged data succeed |
| `notify` | Every action that should notify a persona produces exactly one entry in that persona's notification inbox; none for non-recipients |
| `timing` | Per request kind, p50/p95 are recorded; a jump over the 7-night median is flagged, not failed |
| `gap` | Gap moments are listed, never failed |
| `coverage` | Routes and screens not reached in 14 nights are listed, never failed |

## Edge cases

- A night is interrupted (sleep, crash, cap reached): the next night starts from a fresh snapshot; the report marks the interrupted night incomplete.
- The Mac sleeps through the slot or the maintainer is away: the night is missed, not run late; the next report and `sim status` say so.
- Docker Desktop does not come up: the night ends with a report and no actions; the instance is not changed.
- `main` has a migration that needs a manual step: the upgrade oracle fails, the night stops, the instance stays on the previous commit until the next night.
- A persona's action fails because of a known open bug: the planner records it as `blocked-by #N` (from a local known-issues list) instead of re-reporting it every night.
- Teams work (#1915) lands mid-simulation: the world reconciler applies the new model on the next night; friction it causes is logged as a gap moment.
- Disk growth: Drive uploads of print files grow the data directory. Uploads use generated files of the target size; the world caps total Drive volume at 10 GB, and closing a project deletes its superseded print files. The report shows growth per night, measured as the volume's used space, because `du` counts cloned blocks once per snapshot.
- Replay of a night older than the snapshot window: refused with a clear message.

## Phase 2: decided after three nights

Not built in this issue. After the first three unattended nights, triage records which of these get their own issue, based on what those nights found. The design below is the starting point for that issue.

- **Fault injection.** The planner draws faults from the seed. Budget in real minutes: at most 4 fault windows per night, each at most 2 minutes, at least 10 minutes apart, none in the first 10 or the last 20 minutes of the action window, so `convergence` and `notify` run on a settled workspace. Kinds:
  - `api-restart`: the `web` container is stopped mid-action and started after 5–30 s.
  - `net`: a fault proxy in front of the instance adds latency, drops connections or answers 502 for a window.
  - `clock-skew`: one UI persona's browser clock runs 2–10 minutes off for the night (Playwright clock).
  Every fault is written to the night log with start and end. The `errors` oracle ignores failures inside a fault window that the fault explains; a write lost inside a window still fails `convergence`. There is no quota fault: the API has no per-account quota to set, free disk is the only limit (`overQuota`), and filling the real disk is out of scope.
- **Shrinking.** Only for a failure that reproduces 3 times out of 3 on a fault-free replay. `sim shrink <date> --action <n>` runs delta debugging (ddmin) over the actions before `n` on scratch clones of the snapshot. The planner emits dependency edges (a reply needs its message, a share needs its file), so a candidate never drops a prerequisite of a kept action. A candidate counts as failing only when it fails twice in a row. The final sequence is replayed 3 more times; if any run passes, the report keeps the unshrunk sequence and marks it "not shrinkable". Time box: 30 minutes per failure, at most 3 failures per morning. A failure that needs a fault to reproduce is filed with the full sequence and the fault named, never shrunk.
- **Coverage steering.** Where the planner has a free choice (which project chore, which file operation, which view), it weights options by days since last reached in `coverage.json`. Because the file is part of the snapshot, replay stays deterministic.
