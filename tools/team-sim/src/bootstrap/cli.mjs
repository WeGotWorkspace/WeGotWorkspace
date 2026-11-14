import { join } from "node:path";
import { createRequestLog } from "../client/http.mjs";
import { createSessions } from "../client/session.mjs";
import { layout, origin } from "../instance/config.mjs";
import { openRegistry } from "../state/registry.mjs";
import { loadWorld } from "../world/load.mjs";
import { infraOn } from "../world/infra.mjs";
import { createInfra } from "../actors/api/infra.mjs";
import { applyPlan, describe, planReconcile, readServer } from "./reconcile.mjs";

/** World reconcile for `date` against a running instance; returns the writes it made. */
export async function reconcileWorld({ project = "wgw-sim", dataDir, date, log, dryRun = false, requestLog, resetBudget }) {
  const world = loadWorld();
  const client = createSessions({ origin: origin(project), requestLog: requestLog ?? createRequestLog(null), resetBudget });
  const registry = openRegistry(dataDir);
  const admin = client("admin", "bootstrap");
  const server = await readServer(admin, registry);
  const writes = planReconcile({ world, date, server, infra: infraOn(world, date) });
  log(`reconcile ${date}: ${writes.length} write(s)`);
  if (dryRun) {
    for (const w of writes) log(`  would ${describe(w)}`);
    return writes;
  }
  const infraClient = (u) => client(u, "bootstrap");
  await applyPlan({ admin, writes, registry, infraCreate: createInfra({ world, client: infraClient, origin: origin(project) }), log });
  registry.save();
  return writes;
}

export async function runBootstrap({ date, log, dryRun }) {
  const paths = layout();
  const writes = await reconcileWorld({ dataDir: paths.data, date, log, dryRun, requestLog: createRequestLog(join(paths.runs, date, "bootstrap-requests.jsonl")) });
  log(`done: ${writes.length} write(s)`);
}
