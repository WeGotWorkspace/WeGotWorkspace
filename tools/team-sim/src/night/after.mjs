// After the night: friction measurement, persona diaries and (on Sunday) the
// weekly digest. Reads only the finished run's files, so it can run again
// (`sim diary <date>`) and never touches the action list or replay.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClaudeRunner } from "../diary/claude.mjs";
import { NIGHT_BUDGET_USD, writeDiaries } from "../diary/diary.mjs";
import { DIGEST_BUDGET_USD, weeklyDigest } from "../diary/digest.mjs";
import { stateDir } from "../instance/config.mjs";
import { frictionTrend, measureNight } from "../friction/measure.mjs";
import { addDays, weekday } from "../planner/dates.mjs";
import { readJson, readRun, writeJson } from "./runfiles.mjs";

/** Measures friction for `date` and stores it in the run dir and the cross-night history. */
export function measureRun({ paths, date }) {
  const runDir = join(paths.runs, date);
  const run = readRun(runDir);
  if (!run.plan) throw new Error(`no plan for ${date} under ${runDir}`);
  const measured = measureNight(run);
  const historyFile = join(stateDir(paths.data), "friction.json");
  const { trend, itemNights, nextHistory } = frictionTrend(readJson(historyFile, { nights: [] }), date, measured);
  writeJson(historyFile, nextHistory);
  const measure = { ...measured, trend, itemNights };
  writeJson(join(runDir, "measure.json"), measure);
  return { run, runDir, measure };
}

/**
 * Friction, diaries and the Sunday digest for one night. Fails nothing: a
 * missing or logged-out CLI turns into a note in the report.
 */
export async function afterNight({ paths, world, date, log = () => {}, diaries = true, runner = createClaudeRunner({ cwd: join(paths.runs, date, "diary") }) }) {
  const { run, runDir, measure } = measureRun({ paths, date });
  const sunday = weekday(date) === 0;
  let diary = { skipped: "Diaries switched off for this run.", diaries: [], notes: [], costUsd: 0, tokens: 0, ms: 0 };
  if (diaries) {
    diary = await writeDiaries({ world, date, run, measured: measure, runner, budgetUsd: NIGHT_BUDGET_USD - (sunday ? DIGEST_BUDGET_USD : 0), log });
    writeJson(join(runDir, "diary.json"), diary);
    log(diary.skipped ?? `diaries: ${diary.diaries.length} written, $${diary.costUsd.toFixed(3)}, ${diary.tokens} tokens, ${Math.round(diary.ms / 1000)} s`);
  }
  let digest = null;
  if (sunday) {
    const nights = [];
    for (let d = addDays(date, -6); d <= date; d = addDays(d, 1)) {
      const dir = join(paths.runs, d);
      if (!existsSync(dir)) continue;
      nights.push({ date: d, measure: readJson(join(dir, "measure.json"), null), diary: readJson(join(dir, "diary.json"), null) });
    }
    digest = await weeklyDigest({ nights, date, runner: diaries ? runner : null });
    writeJson(join(runDir, "digest.json"), digest);
    log(digest.skipped ?? `digest: ${digest.themes.length} themes, $${digest.costUsd.toFixed(3)}`);
  }
  return { measure, diary, digest };
}

/** What the report's Team voice section needs, read back from a run dir. */
export function readVoice(runDir) {
  const measure = readJson(join(runDir, "measure.json"), null);
  if (!measure) return null;
  return { measure, diary: readJson(join(runDir, "diary.json"), null), digest: readJson(join(runDir, "digest.json"), null) };
}

