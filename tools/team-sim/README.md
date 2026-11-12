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
node tools/team-sim/bin/sim.mjs replay 2026-11-12 --plan-only
node tools/team-sim/bin/sim.mjs replay 2026-11-12 --action 41
node tools/team-sim/bin/sim.mjs report 2026-11-12  # re-render from the run files
node tools/team-sim/bin/sim.mjs status
node tools/team-sim/bin/sim.mjs down
pnpm --dir tools/team-sim test [-- planner|instance|actors/api|oracles|report|replay|schedule]
```

`night` takes `--minutes N` (default 55 minutes of actions; less squeezes the
same action list into a shorter window and says so in the report),
`--skip-upgrade`, `--ui-only` and `--api-only`. Scheduling (launchd, wake) is
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
   four personas use the app in Chromium, the rest the REST/JMAP API, one only
   CalDAV/CardDAV.
5. Settle, then the oracles: `upgrade`, `errors`, `convergence`, `notify`,
   `visibility` (private), `dav-parity`, `timing` (flags only), `coverage`,
   `gap`.
6. Report to `~/.wgw-sim/reports/<date>.md`; the stack is stopped.

Findings stay in that local report. Visibility findings are never filed or
posted anywhere.

## Layout

| Path | What |
|---|---|
| `world/` | Personas, Teams, clients, projects and rhythm (fictional, `example.org` clients) |
| `src/planner/` | Pure planner: `(world, date, snapshot) → action list + hash` |
| `src/instance/` | Guard, Compose, upgrade with rollback, snapshots |
| `src/bootstrap/` | Idempotent world reconcile |
| `src/actors/api`, `src/actors/ui` | API/DAV executors and Playwright flows |
| `src/night/` | Real-time engine and the night runner |
| `src/oracles/` | Checks after the night |
| `src/report/`, `src/replay/`, `src/schedule/` | Morning report, replay, status |
