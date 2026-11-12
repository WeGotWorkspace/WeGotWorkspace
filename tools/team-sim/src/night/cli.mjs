import { layout } from "../instance/config.mjs";
import { planNight } from "../planner/planner.mjs";
import { snapshotSummary } from "../state/registry.mjs";
import { loadWorld } from "../world/load.mjs";

/** `sim plan`: the night's action list from a data dir (default the live one). `--json` prints the whole plan. */
export async function printPlan({ date, json = false, dataDir = layout().data, log = console.log }) {
  const plan = planNight({ world: loadWorld(), date, snapshot: snapshotSummary(dataDir) });
  if (json) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return plan;
  }
  const byKind = {};
  for (const a of plan.actions) byKind[`${a.layer} ${a.kind}`] = (byKind[`${a.layer} ${a.kind}`] ?? 0) + 1;
  log(`plan ${date} (${plan.weekday}${plan.light ? ", light" : ""}): ${plan.actions.length} actions, hash ${plan.hash}`);
  log(`present: ${plan.present.join(", ")}; absent: ${Object.entries(plan.absent).map(([p, w]) => `${p} (${w})`).join(", ") || "none"}; UI: ${plan.ui.join(", ") || "none"}`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(3)}  ${k}`);
  return plan;
}
