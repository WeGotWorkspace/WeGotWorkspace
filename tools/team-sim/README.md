# Team simulation (phase 1)

A fictional studio of ten people uses a local WeGotWorkspace instance for a
working day, every night, and leaves a private morning report. Spec, plan and
tasks: [`.agents/specs/1981-team-simulation/`](../../.agents/specs/1981-team-simulation/spec.md).

Everything runs on this machine. The instance listens on `127.0.0.1:9290`
(replay `:9291`), MailHog on `:2590/:2580` (replay `:2591/:2581`); the dev and
PR-test ports are refused. Data, snapshots, runs and reports live under
`~/.wgw-sim` (override with `WGW_SIM_HOME`), never in a repository checkout.

## Commands

```bash
node tools/team-sim/bin/sim.mjs up                 # worktree at origin/main, build, start wgw-sim
node tools/team-sim/bin/sim.mjs bootstrap          # reconcile the world for today (idempotent)
node tools/team-sim/bin/sim.mjs plan --date 2026-11-12
node tools/team-sim/bin/sim.mjs night --date 2026-11-12 --minutes 25
node tools/team-sim/bin/sim.mjs night --date 2026-11-12 --habits all   # every Google habit and import type once
node tools/team-sim/bin/sim.mjs replay 2026-11-12 --plan-only
node tools/team-sim/bin/sim.mjs replay 2026-11-12 --action 41
node tools/team-sim/bin/sim.mjs report 2026-11-12  # re-render from the run files
node tools/team-sim/bin/sim.mjs diary 2026-11-12   # friction, diaries (and Sunday digest) again
node tools/team-sim/bin/sim.mjs status
node tools/team-sim/bin/sim.mjs down
pnpm --dir tools/team-sim test [-- planner|instance|actors/api|oracles|report|replay|schedule|friction|diary]
```

`night` takes `--minutes N` (default 55 minutes of actions; less squeezes the
same action list into a shorter window and says so in the report),
`--skip-upgrade`, `--ui-only`, `--api-only`, `--no-diary` and `--habits all`
(also on `plan`; kept in the snapshot meta so replay plans the same list). Scheduling (launchd, wake) is
not part of this phase.

## A night

1. Upgrade: fast-forward the worktree, build, start, migrate. On failure the
   pre-upgrade clone and commit are restored and the night stops.
2. Reconcile the world (people, Teams, mail settings, project channels, task
   lists and folders) for tonight's date.
3. Snapshot the data dir (APFS clone) with the writers stopped; the planner
   computes tonight's action list from that clone. `meta.json` keeps the
   commit and the action-list hash for replay.
4. Actions in real time: each persona runs its own actions in order; three or
   four personas use the web apps in their own browser (Chrome or Safari on the
   Mac; chat, notes and tasks sometimes on their iPhone or Android phone), the
   rest the REST/JMAP API. Calendar, Contacts and Tasks of a persona who keeps
   Apple's apps (or DAVx5 on Android) go through CalDAV/CardDAV as that app.
5. Settle, then the oracles: `upgrade`, `errors`, `convergence`, `notify`,
   `visibility` (private), `dav-parity`, `timing` (flags only), `coverage`,
   `gap`.
6. The stack is stopped. Friction is measured from the run files, and each
   persona who worked writes a diary (Sunday: also the weekly digest).
7. Report to `~/.wgw-sim/reports/<date>.md`.

Findings stay in that local report. Visibility findings are never filed or
posted anywhere.

## Team voice

The report's private "Team voice" section is for the product lead; triage
never files it.

- **Friction** (deterministic). Actions are grouped into persona goals
  (`src/friction/measure.mjs`: an action joins the chain of the action it
  depends on). Per goal: steps, requests (background polling left out),
  retries, time, time spent waiting, clicks and keystrokes for browser
  personas, failures, and the trend against the 7-night median
  (`.team-sim/friction.json` in the data dir). Actor code reports every
  workaround it needs through `ctx.friction({ what, workaround, source })`;
  `Unsupported` carries one too. Browser flows record time to interactive per
  screen and a screenshot per action under `runs/<date>/shots/`.
- **Diaries** (after the night, never during it). `src/diary/` runs the local
  `claude -p` headless with the `haiku` model, no tools, no MCP servers and
  no saved session, on the facts of one persona's own actions plus up to two
  screenshots. Every claim cites action numbers, which are checked against
  that persona's actions. Caps: $0.08 per diary, $0.60 and 10 minutes per
  night. A missing or logged-out CLI skips the diaries with a note and fails
  nothing. The action list and replay never read a diary.
- **Since Google** (deterministic). The studio moved from Google Workspace
  together, for control over its own data. `habit` actions try the Google way
  (`world/habits.json`); `migrate.import` actions bring in what is left in the
  Google export (`world/takeout/`). A habit the suite lacks is friction, never
  a failure; content an import loses fails the action. The report's table
  shows per habit tries, how many worked and the 7-night history, per import
  type what came over complete.
- **Devices** (deterministic). Browser actions run in the persona's browser:
  Chromium for Chrome, WebKit for Safari (with a profile on disk, because
  WebKit's own contexts are like a private window where IndexedDB keeps no
  files), the iPhone 15 and Pixel 7 profiles for phones. Meet calls stay in
  Chromium (fake camera). Native apps keep a local copy, sync with
  `sync-collection` at most every 3 minutes, write with `If-Match` and retry
  once on `412`. Their dialects (`src/actors/api/dav.mjs`) are approximations
  until recorded from the real apps; offline queueing on a phone is not built.
  `dav-parity` checks that what a native app wrote tonight reads the same in
  the web app and keeps its dialect's properties.
- **Weekly digest** (Sunday). The model only groups the week's diary items
  into themes; frequency (distinct persona-days) and cost (goal time behind the
  cited actions) are counted in code, with evidence as `date #n`.

## Layout

| Path | What |
|---|---|
| `world/` | Personas (with habits and devices), Teams, clients, projects and rhythm (fictional, `example.org` clients); `habits.json`; `takeout/` (the Google export fixtures) |
| `src/planner/` | Pure planner: `(world, date, snapshot) → action list + hash` |
| `src/instance/` | Guard, Compose, upgrade with rollback, snapshots |
| `src/bootstrap/` | Idempotent world reconcile |
| `src/actors/api`, `src/actors/ui` | API/DAV executors and Playwright flows |
| `src/night/` | Real-time engine and the night runner |
| `src/oracles/` | Checks after the night |
| `src/report/`, `src/replay/`, `src/schedule/` | Morning report, replay, status |
| `src/friction/`, `src/diary/` | Goal cost and workarounds; persona diaries and the weekly digest |
