import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const jsonl = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const json = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

export const readJson = json;
export const writeJson = (file, value) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
};

/** Everything a finished night left in its run dir. Missing files read as empty (older runs). */
export function readRun(runDir) {
  return {
    plan: json(join(runDir, "plan.json"), null),
    outcomes: jsonl(join(runDir, "outcomes.jsonl")),
    requests: jsonl(join(runDir, "requests.jsonl")),
    interactions: jsonl(join(runDir, "interactions.jsonl")),
    friction: jsonl(join(runDir, "friction.jsonl")),
    results: json(join(runDir, "results.json"), null),
  };
}
