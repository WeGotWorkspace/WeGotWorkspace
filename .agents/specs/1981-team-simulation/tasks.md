# Engineering tasks — Nightly team simulation

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `sim-world-planner` | builder | testing | `tools/team-sim/world/`, `tools/team-sim/src/planner/`, `tools/team-sim/src/corpus/` | `pnpm --dir tools/team-sim test -- planner` |
| `sim-instance` | builder | dev-environment | `tools/team-sim/src/instance/`, `tools/team-sim/compose.sim.yml`, `tools/team-sim/bin/sim.mjs` | `pnpm --dir tools/team-sim test -- instance`; `node tools/team-sim/bin/sim.mjs up --dry-run` |
| `sim-bootstrap` | builder | testing, api | `tools/team-sim/src/bootstrap/` | `node tools/team-sim/bin/sim.mjs bootstrap` twice on a scratch data dir; second run reports 0 changes |
| `sim-api-actors` | builder | testing, client-transport | `tools/team-sim/src/actors/api/` | `pnpm --dir tools/team-sim test -- actors/api`; one light night on a scratch data dir |
| `sim-ui-actors` | builder | testing, workspace | `tools/team-sim/src/actors/ui/` | one night with `--ui-only`; traces under `~/.wgw-sim/runs/<date>/` |
| `sim-oracles` | builder | testing, security | `tools/team-sim/src/oracles/` | `pnpm --dir tools/team-sim test -- oracles` (each oracle fails on a planted fault) |
| `sim-report-replay` | builder | testing, document | `tools/team-sim/src/report/`, `tools/team-sim/src/replay/` | `node tools/team-sim/bin/sim.mjs replay <date>` reproduces the action-list hash |
| `sim-schedule-skill` | builder | dev-environment, document | `tools/team-sim/launchd/`, `tools/team-sim/src/schedule/`, `.agents/skills/testing/team-simulation.md` | `node tools/team-sim/bin/sim.mjs schedule install --dry-run`; `pnpm --dir tools/team-sim test -- schedule`; `pnpm run check:agent-docs` |
| `sim-verify` | verifier | testing | read-only | [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md); three consecutive unattended nights; phase 2 decision on #1981 |

## Notes

- Chunk `id` values match `plan.md` chunk ids.
- Phase 2 (fault injection, shrinking, coverage steering) has no rows here; each part chosen after three nights gets its own issue and spec.
- On scope change: update [#1981](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/1981) first, then re-sync spec, plan, tasks and the `Source:` body-hash.
