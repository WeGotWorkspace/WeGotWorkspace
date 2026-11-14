import { createHash } from "node:crypto";
import { createRng, seedFrom } from "../planner/prng.mjs";
import { oracleResult } from "./result.mjs";

export const OLDER_SAMPLE = 200;
const CHECKED_TYPES = new Set(["message", "dm", "task", "note", "doc", "comment", "event", "contact", "file"]);

/**
 * Which objects to check tonight: everything touched tonight plus a fixed
 * sample of 200 older ones in a seeded rotating order. The rotation is a
 * seeded shuffle of all older keys; night k checks the window
 * [k*200, k*200+200) of that order, so every object comes round once per
 * ceil(older/200) nights and the cost stays flat as the workspace grows.
 */
export function pickChecked(objects, date, nightIndex) {
  const live = objects.filter((o) => CHECKED_TYPES.has(o.type) && o.ids);
  const tonight = live.filter((o) => o.night === date || o.touched === date);
  const older = live.filter((o) => !(o.night === date || o.touched === date)).sort((a, b) => (a.key < b.key ? -1 : 1));
  const order = createRng(seedFrom("convergence-rotation")).shuffle(older);
  const sample = [];
  if (order.length) {
    const start = (nightIndex * OLDER_SAMPLE) % order.length;
    for (let i = 0; i < Math.min(OLDER_SAMPLE, order.length); i += 1) sample.push(order[(start + i) % order.length]);
  }
  return { tonight, sample, intervalNights: Math.max(1, Math.ceil(older.length / OLDER_SAMPLE)) };
}

/** Who may read an object: Team members started by tonight, the owner of personal things, both sides of a DM. */
export function readersOf(world, o, date) {
  const scope = o.scope ?? "";
  if (scope.startsWith("own:")) return [scope.slice(4)];
  if (scope.startsWith("dm:")) return scope.slice(3).split("+");
  if (o.type === "event") return [o.owner, ...(o.attendees ?? [])].filter((p, i, a) => a.indexOf(p) === i && world.startedBy(p, date));
  const team = world.teams.find((t) => t.id === scope);
  return team ? world.teamMembersOn(team.id, date) : [o.owner];
}

const hash = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);

/**
 * Reads each checked object as every reader and compares normalized state.
 * `read(persona, object)` returns the normalized state or `{ absent: true }`;
 * `expect(object)` returns what the registry says the state must include.
 */
export async function convergenceOracle({ world, date, objects, nightIndex, read, budget, concurrency = 4 }) {
  const { tonight, sample, intervalNights } = pickChecked(objects, date, nightIndex);
  const checks = [...tonight, ...sample];
  const failures = [];
  let done = 0;
  let unchecked = 0;
  const queue = [...checks];
  async function worker() {
    while (queue.length) {
      const o = queue.shift();
      if (budget.exceeded()) {
        unchecked += 1;
        continue;
      }
      const readers = readersOf(world, o, date);
      const views = [];
      for (const p of readers) {
        try {
          views.push({ p, v: await read(p, o) });
        } catch (e) {
          views.push({ p, v: { error: e.message.slice(0, 160) } });
        }
      }
      done += 1;
      const problem = compareViews(o, views);
      if (problem) failures.push({ signature: `convergence:${o.type}:${problem.kind}`, persona: problem.persona, action: o.action, detail: `${o.type} ${o.key}: ${problem.text}` });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return oracleResult("convergence", {
    failures,
    unchecked: done === 0 && checks.length > 0,
    notes: [
      `Checked ${done} objects (${tonight.length} touched tonight, ${sample.length} older) as every reader${unchecked ? `; ${unchecked} left unchecked at the oracle time cap` : ""}.`,
      `An older object is checked again every ~${intervalNights} night(s).`,
    ],
    metrics: { tonight: tonight.length, sample: sample.length, intervalNights, unchecked },
  });
}

export function compareViews(o, views) {
  const errored = views.find((x) => x.v?.error);
  if (errored) return { kind: "read-error", persona: errored.p, text: `${errored.p} cannot read it: ${errored.v.error}` };
  const expectAbsent = o.status === "deleted";
  for (const { p, v } of views) {
    if (expectAbsent && !v.absent) return { kind: "deleted-still-visible", persona: p, text: `deleted, but ${p} still sees it` };
    if (!expectAbsent && v.absent) return { kind: "missing", persona: p, text: `${p} does not see it` };
    if (v.mismatch) return { kind: "lost-write", persona: p, text: `${p}: ${v.mismatch}` };
  }
  const states = views.filter((x) => !x.v.absent).map((x) => ({ p: x.p, h: hash(JSON.stringify(x.v.state ?? null)) }));
  const distinct = [...new Set(states.map((s) => s.h))];
  if (distinct.length > 1) {
    const groups = distinct.map((h) => states.filter((s) => s.h === h).map((s) => s.p).join(", "));
    return { kind: "diverged", persona: states[0].p, text: `readers see different states: ${groups.join(" | ")}` };
  }
  return null;
}
