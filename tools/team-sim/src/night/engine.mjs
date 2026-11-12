import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const WORKDAY_MINUTES = 510;
const DEP_WAIT_MS = 10 * 60000;

/**
 * Plays the action list in real time. The simulated workday (09:00–17:30)
 * is squeezed into `windowMs`; each persona runs its actions in order, so a
 * persona never does two things at once, while personas run side by side.
 * An action waits for its dependencies; if one failed or was skipped, the
 * action is skipped. Past `deadline` everything left is skipped.
 */
export async function runActions({ plan, windowMs, execute, deadline, outcomesFile, log = () => {}, filter = () => true, now = () => Date.now(), sleep = defaultSleep }) {
  const start = now();
  const done = new Map(); // n -> outcome
  const waiters = new Map(); // n -> [resolve]
  const outcomes = [];
  if (outcomesFile) mkdirSync(dirname(outcomesFile), { recursive: true });

  const finish = (action, outcome) => {
    const full = { n: action.n, persona: action.persona, kind: action.kind, app: action.app, layer: action.layer, minute: action.minute, ...outcome };
    done.set(action.n, full);
    outcomes.push(full);
    if (outcomesFile) appendFileSync(outcomesFile, `${JSON.stringify(full)}\n`);
    for (const resolve of waiters.get(action.n) ?? []) resolve(full);
    waiters.delete(action.n);
  };
  const waitFor = (n) =>
    done.has(n)
      ? Promise.resolve(done.get(n))
      : new Promise((resolve) => {
          (waiters.get(n) ?? waiters.set(n, []).get(n)).push(resolve);
        });

  const byPersona = new Map();
  for (const a of plan.actions) (byPersona.get(a.persona) ?? byPersona.set(a.persona, []).get(a.persona)).push(a);

  async function personaLoop(actions) {
    for (const action of actions) {
      if (!filter(action)) {
        finish(action, { status: "skipped", reason: "filtered" });
        continue;
      }
      const due = start + (action.minute / WORKDAY_MINUTES) * windowMs;
      if (due > now()) await sleep(Math.min(due, deadline) - now());
      if (now() >= deadline) {
        finish(action, { status: "skipped", reason: "time cap" });
        continue;
      }
      let timer;
      const timeout = new Promise((r) => {
        timer = setTimeout(() => r(null), DEP_WAIT_MS);
      });
      const deps = await Promise.race([Promise.all(action.deps.map(waitFor)), timeout]);
      clearTimeout(timer);
      const blocked = deps === null ? "dependency did not finish in time" : deps.find((d) => d.status !== "ok") && `dependency #${deps.find((d) => d.status !== "ok").n} ${deps.find((d) => d.status !== "ok").status}`;
      if (blocked) {
        finish(action, { status: "skipped", reason: blocked });
        continue;
      }
      const t0 = now();
      try {
        const result = await execute(action);
        finish(action, { status: "ok", ms: now() - t0, ...(result?.note ? { note: result.note } : {}) });
      } catch (error) {
        log(`#${action.n} ${action.persona} ${action.kind} failed: ${error.message.split("\n")[0]}`);
        finish(action, { status: "failed", ms: now() - t0, error: error.message, trace: error.trace });
      }
    }
  }

  await Promise.all([...byPersona.values()].map(personaLoop));
  return outcomes.sort((a, b) => a.n - b.n);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
