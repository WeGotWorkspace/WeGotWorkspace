import { oracleResult } from "./result.mjs";

/** Build and migrations on the aged data succeed. Reads the instance step's result. */
export function upgradeOracle({ upgrade }) {
  if (!upgrade) return oracleResult("upgrade", { notes: ["Upgrade skipped for this run (--skip-upgrade)."], unchecked: true });
  if (!upgrade.ok) return oracleResult("upgrade", { failures: [{ signature: "upgrade:failed", detail: `upgrade from ${upgrade.before?.slice(0, 10)} failed: ${String(upgrade.error).split("\n")[0]}` }] });
  return oracleResult("upgrade", { notes: [`${upgrade.before?.slice(0, 10)} → ${upgrade.after?.slice(0, 10)}: ${upgrade.migrated ?? "ok"}`] });
}
