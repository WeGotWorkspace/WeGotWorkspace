import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readVoice } from "../night/after.mjs";
import { renderReport } from "./report.mjs";

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

/** `sim report <date>`: re-render the morning report from a finished run's files. Changes no state. */
export async function rerenderReport({ date, paths }) {
  const runDir = join(paths.runs, date);
  const saved = readJson(join(runDir, "results.json"), null);
  if (!saved) throw new Error(`no finished run for ${date} under ${runDir}`);
  const outcomesFile = join(runDir, "outcomes.jsonl");
  const outcomes = existsSync(outcomesFile) ? readFileSync(outcomesFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const flaky = readJson(paths.flaky, {});
  // The stored flaky map already counts tonight; rendering again does not add a night.
  return renderReport({
    date,
    night: saved.night,
    plan: readJson(join(runDir, "plan.json"), null),
    outcomes,
    results: saved.results,
    upgrade: saved.upgrade,
    flaky,
    known: readJson(paths.knownIssues, []),
    nightsLog: readJson(paths.nightsLog, []).filter((n) => n.date !== date),
    disk: saved.disk,
    productHistory: readJson(join(paths.home, "product.json"), []),
    voice: readVoice(runDir),
  }).markdown;
}
