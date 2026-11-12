import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setPriority } from "node:os";
import { executeApi, recordResult } from "../actors/api/index.mjs";
import { Unsupported } from "../actors/api/collab.mjs";
import { SCREENS } from "../actors/ui/browser.mjs";
import { reconcileWorld } from "../bootstrap/cli.mjs";
import { createRequestLog } from "../client/http.mjs";
import { createSessions } from "../client/session.mjs";
import { HARNESS_DIR, PROJECTS, layout, origin as originOf, stateDir } from "../instance/config.mjs";
import { createInstance } from "../instance/instance.mjs";
import { createShell } from "../instance/sh.mjs";
import { pruneSnapshots, takeSnapshot } from "../instance/snapshot.mjs";
import { mailHog, runOracles } from "../oracles/index.mjs";
import { loadTemplates } from "../oracles/routes.mjs";
import { planNight } from "../planner/planner.mjs";
import { renderReport } from "../report/report.mjs";
import { LATEST_START_HOUR, recordMissed, startedTooLate } from "../schedule/status.mjs";
import { openRegistry, snapshotSummary } from "../state/registry.mjs";
import { loadWorld } from "../world/load.mjs";
import { runActions } from "./engine.mjs";

const PROJECT = "wgw-sim";
const SPEC_MINUTES = { total: 75, actions: 55, settle: 5, oracles: 15 };

export const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
export const writeJson = (file, value) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
};

/**
 * How the night's minutes split. The spec's night is 55 min of actions,
 * 5 settle and at most 15 of oracles. A shorter `minutes` scales actions and
 * settle down (settle at least 1 minute) and says so in the report.
 */
export function timeBudget(minutes) {
  if (minutes >= SPEC_MINUTES.actions) return { actionsMs: SPEC_MINUTES.actions * 60000, settleMs: SPEC_MINUTES.settle * 60000, oracleCapMs: SPEC_MINUTES.oracles * 60000, shortened: null };
  const actions = Math.max(2, Math.round(minutes * 0.85));
  const settle = Math.max(1, Math.min(SPEC_MINUTES.settle, minutes - actions));
  return {
    actionsMs: actions * 60000,
    settleMs: settle * 60000,
    oracleCapMs: SPEC_MINUTES.oracles * 60000,
    shortened: `the workday was squeezed into ${actions} min of actions (spec: ${SPEC_MINUTES.actions}) with ${settle} min of settle (spec: ${SPEC_MINUTES.settle}); the action list itself is the full night's.`,
  };
}

/**
 * One night, end to end: upgrade (or start), reconcile, snapshot and plan
 * from the snapshot, actions in real time, settle, oracles, report. The
 * stack is stopped at the end. Returns `{ ok, reportFile }`; ok means the
 * night completed, not that every oracle passed.
 */
export async function runNight({ date, minutes = 55, uiOnly = false, apiOnly = false, skipUpgrade = false, manual = false, log = console.log, repoRoot, headless = true }) {
  try {
    setPriority(10);
  } catch {
    // Lowered priority is best effort.
  }
  const paths = layout();
  if (!manual && startedTooLate()) {
    recordMissed(paths, date, `scheduled run started at ${new Date().toLocaleTimeString("nl-NL")}`);
    log(`night ${date} skipped: started after 0${LATEST_START_HOUR}:00`);
    return { ok: false, missed: true };
  }
  const runDir = join(paths.runs, date);
  mkdirSync(runDir, { recursive: true });
  const shell = createShell({ log: (l) => appendLog(runDir, l) });
  const instance = createInstance({ shell, project: PROJECT, checkout: paths.checkout, dataDir: paths.data, liveDataDir: paths.data, snapshotsDir: paths.snapshots, repoRoot, log });
  const budget = timeBudget(minutes);
  const notes = [];
  if (budget.shortened) notes.push(budget.shortened);
  if (skipUpgrade) notes.push("the upgrade step was skipped (--skip-upgrade): the stack ran the commit already checked out.");
  if (uiOnly) notes.push("only browser actions ran (--ui-only).");
  if (apiOnly) notes.push("browser actions ran through the API (--api-only).");
  const night = { date, startedAt: new Date().toISOString(), manual, minutes, shortened: notes.join(" ") || null };
  const nightsLog = readJson(paths.nightsLog, []);
  log(`night ${date}: ${minutes} min${budget.shortened ? " (shortened)" : ""}`);

  await instance.ensureDocker();
  instance.guard();
  instance.ensureWorktree();

  // 1. Upgrade to origin/main (rollback on failure), or just start.
  let upgrade = null;
  if (skipUpgrade) {
    await instance.start();
  } else {
    log("upgrade: fast-forward, build, start, migrate");
    upgrade = await instance.upgrade({ rollbackDir: paths.rollback });
    if (!upgrade.ok) return finishFailed({ paths, date, night, upgrade, nightsLog, log, instance, reason: "upgrade failed" });
  }
  night.sha = instance.sha();

  // 2. Reconcile the world for tonight. A failure here rolls back like an upgrade failure.
  const requestLog = createRequestLog(join(runDir, "requests.jsonl"));
  const resetBudget = throttle(() => instance.artisan("cache:clear"), 60000);
  try {
    await reconcileWorld({ project: PROJECT, dataDir: paths.data, date, log, requestLog, resetBudget });
  } catch (error) {
    log(`reconcile failed: ${error.message}`);
    if (upgrade) instance.rollback({ rollbackDir: paths.rollback, sha: upgrade.before });
    return finishFailed({ paths, date, night, upgrade: { ...(upgrade ?? {}), ok: false, error: `reconcile: ${error.message}` }, nightsLog, log, instance, reason: "reconcile failed" });
  }

  // 3. Snapshot (writers stopped), plan from the snapshot clone, start again.
  const world = loadWorld();
  const harnessSha = gitSha(HARNESS_DIR);
  const snap = takeSnapshot({
    shell,
    instance,
    date,
    dataDir: paths.data,
    snapshotsDir: paths.snapshots,
    envFile: join(paths.checkout, "packages", "api", ".env"),
    meta: { sha: night.sha, harnessSha, harnessDirty: gitDirty(HARNESS_DIR), worldVersion: world.meta.version, minutes },
    planFrom: (clone) => planNight({ world, date, snapshot: snapshotSummary(clone) }),
  });
  const plan = snap.plan;
  writeJson(join(runDir, "plan.json"), plan);
  const pruned = pruneSnapshots(shell, paths.snapshots);
  if (pruned.length) log(`pruned snapshots ${pruned.join(", ")}`);
  await instance.start();
  log(`plan ${plan.hash.slice(0, 12)}: ${plan.actions.length} actions, ${plan.present.length} present, UI ${plan.ui.join(", ") || "none"}`);

  // 4. Actions in real time.
  const origin = originOf(PROJECT);
  const mail = mailHog(PROJECTS[PROJECT].mailApi);
  await mail.clear().catch(() => {});
  night.actionsStartedAt = new Date().toISOString();
  const registry = openRegistry(paths.data);
  const client = createSessions({ origin, requestLog, resetBudget });
  const expected = [];
  const expectedMails = [];
  const ctx = {
    world,
    client,
    origin,
    registry,
    date,
    expectNotify: (e) => expected.push(e),
    expectMail: (e) => expectedMails.push(e),
    guestClient: () => client("guest", "guest"),
  };
  const useUi = !apiOnly && plan.actions.some((a) => a.layer === "ui");
  const ui = useUi ? await (await import("../actors/ui/index.mjs")).createUiLayer({ origin, runDir, requestLog, headless }) : null;
  const unsupported = [];
  const execute = async (action) => {
    if (action.kind === "gap") return { note: "gap moment (nothing to do in the suite)" };
    try {
      const result = action.layer === "ui" && ui ? await ui.execute(action, ctx) : await executeApi(action.layer === "ui" ? { ...action, layer: "api" } : action, ctx);
      recordResult(registry, action, result, date);
      registry.save();
      return result;
    } catch (error) {
      if (error instanceof Unsupported) {
        unsupported.push({ n: action.n, persona: action.persona, kind: action.kind, why: error.message });
        return { note: `unsupported: ${error.message}` };
      }
      throw error;
    }
  };
  const deadline = Date.now() + budget.actionsMs + 5 * 60000;
  let outcomes;
  try {
    outcomes = await runActions({
      plan,
      windowMs: budget.actionsMs,
      execute,
      deadline,
      outcomesFile: join(runDir, "outcomes.jsonl"),
      log: (l) => appendLog(runDir, l),
      filter: uiOnly ? (a) => a.layer === "ui" : () => true,
    });
  } finally {
    if (ui) await ui.close().catch(() => {});
  }
  night.actionsEndedAt = new Date().toISOString();
  const tally = countBy(outcomes, (o) => o.status);
  log(`actions done: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  // 5. Settle, then oracles.
  log(`settle ${Math.round(budget.settleMs / 60000)} min`);
  await new Promise((r) => setTimeout(r, budget.settleMs));
  const sd = stateDir(paths.data);
  const history = readJson(join(sd, "timing.json"), { nights: [] });
  const coverage = readJson(join(sd, "coverage.json"), {});
  const templates = loadTemplates(join(paths.checkout, "packages", "api", "openapi", "openapi.json"));
  const nightIndex = nightsLog.filter((n) => n.status === "done" && n.date < date).length;
  const captured = [];
  const oracle = await runOracles({
    world,
    date,
    plan,
    requests: requestLog.entries,
    browserEvents: ui?.events ?? [],
    screensVisited: [...(ui?.screens ?? [])],
    templates,
    screens: SCREENS.map(([s]) => s),
    objects: registry.all(),
    client,
    origin,
    expected,
    expectedMails,
    nightStart: night.actionsStartedAt,
    upgrade,
    history,
    coverage,
    nightIndex,
    capMs: budget.oracleCapMs,
    log,
    saveInboxes: (dump) => writeJson(join(runDir, "inboxes.json"), dump),
    fetchMail: async () => {
      const list = await mail.messages();
      captured.push(...list);
      return list;
    },
  });
  writeJson(join(runDir, "mail.json"), captured);
  await mail.clear().catch(() => {});
  writeJson(join(sd, "timing.json"), oracle.nextHistory);
  writeJson(join(sd, "coverage.json"), oracle.nextCoverage);
  if (unsupported.length) {
    oracle.results.push({
      name: "unsupported",
      status: "flag",
      failures: [],
      flagged: [],
      product: unsupported.map((u) => ({ kind: "unsupported", persona: u.persona, action: u.n, need: u.kind, workaround: u.why })),
      notes: [],
      metrics: {},
    });
  }

  // 6. Report and cross-night state.
  night.endedAt = new Date().toISOString();
  const disk = measureDisk(paths, readJson(paths.lastNight, null));
  disk.driveBytes = snapshotSummary(paths.data).driveBytes;
  const flaky = readJson(paths.flaky, {});
  const known = readJson(paths.knownIssues, []);
  const productFile = join(paths.home, "product.json");
  const productHistory = readJson(productFile, []);
  const { markdown, nextFlaky } = renderReport({ date, night, plan, outcomes, results: oracle.results, upgrade, flaky, known, nightsLog, disk, productHistory });
  const reportFile = join(paths.reports, `${date}.md`);
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(reportFile, markdown);
  writeJson(join(runDir, "results.json"), { night, upgrade, results: oracle.results, disk, unsupported });
  writeJson(paths.flaky, nextFlaky);
  writeJson(productFile, [...productHistory.filter((p) => p.date !== date), ...oracle.results.flatMap((r) => (r.product ?? []).map((p) => ({ ...p, date })))]);
  writeJson(paths.nightsLog, [...nightsLog.filter((n) => n.date !== date), { date, status: "done", manual, startedAt: night.startedAt, endedAt: night.endedAt }]);
  writeJson(paths.lastNight, { date, endedAt: night.endedAt, sha: night.sha, report: reportFile, usedBytes: disk.usedBytes });
  instance.down();
  log(`report: ${reportFile}`);
  return { ok: true, reportFile, results: oracle.results, outcomes };
}

async function finishFailed({ paths, date, night, upgrade, nightsLog, log, instance, reason }) {
  night.endedAt = new Date().toISOString();
  night.incomplete = true;
  const { markdown } = renderReport({ date, night, plan: null, outcomes: [], results: [], upgrade, flaky: readJson(paths.flaky, {}), known: readJson(paths.knownIssues, []), nightsLog, disk: null });
  const reportFile = join(paths.reports, `${date}.md`);
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(reportFile, markdown);
  writeJson(join(paths.runs, date, "results.json"), { night, upgrade, results: [] });
  writeJson(paths.nightsLog, [...nightsLog.filter((n) => n.date !== date), { date, status: "failed", reason, startedAt: night.startedAt, endedAt: night.endedAt }]);
  instance.down();
  log(`night failed (${reason}); report: ${reportFile}`);
  return { ok: false, reportFile };
}

function measureDisk(paths, last) {
  let usedBytes = null;
  try {
    const out = execFileSync("df", ["-k", paths.home], { encoding: "utf8" }).trim().split("\n").at(-1).split(/\s+/);
    usedBytes = Number(out[2]) * 1024;
  } catch {
    usedBytes = null;
  }
  return { usedBytes, deltaBytes: last?.usedBytes != null && usedBytes != null ? usedBytes - last.usedBytes : 0 };
}

function gitSha(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Uncommitted harness changes make `harnessSha` an approximation; replay says so. */
function gitDirty(dir) {
  try {
    return execFileSync("git", ["-C", dir, "status", "--porcelain", "--", "."], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
}

function appendLog(runDir, line) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "night.log"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

function throttle(fn, ms) {
  let last = 0;
  return async () => {
    if (Date.now() - last < ms) return;
    last = Date.now();
    fn();
  };
}

const countBy = (list, key) => list.reduce((acc, x) => ({ ...acc, [key(x)]: (acc[key(x)] ?? 0) + 1 }), {});
