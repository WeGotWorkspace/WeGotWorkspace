// Friction: what each persona goal cost tonight. Pure: reads the night's run
// files (plan, outcomes, requests, interactions, friction records) and returns
// numbers. Runs after the night, so replay and the action list are untouched.
import { median, percentile } from "../oracles/result.mjs";

/** Persona goals and the action kinds that serve them. */
export const GOALS = Object.freeze({
  "talk to the team": ["chat.post", "chat.reply", "chat.mention", "chat.dm", "chat.leave"],
  "plan and finish work": ["task.create", "task.assign", "task.comment", "task.complete", "task.archive"],
  "keep notes": ["note.create", "note.edit"],
  "write a doc": ["doc.create", "doc.edit", "doc.comment", "doc.resolve"],
  "co-write a doc": ["doc.cowrite"],
  "hand off a file": ["drive.upload", "drive.version", "drive.rename", "drive.move", "drive.delete", "drive.share", "drive.guestDownload"],
  "book a meeting": ["cal.event", "cal.reschedule", "meet.schedule"],
  "answer an invite": ["cal.rsvp"],
  "keep client contacts": ["contact.create", "contact.edit"],
  "hold a call": ["meet.call"],
  "do something the suite cannot": ["gap"],
});

/** Requests a browser makes on its own while an action runs (presence, polling, CSP reports): not steps of the goal. */
const BACKGROUND = /^\/api\/v1\/(rooms\/[^/]+\/(events|participants|configuration)|jmap\/events\/|notifications|settings\/state|csp-reports|me$|jmap\/session)/;

const GOAL_OF = new Map(Object.entries(GOALS).flatMap(([goal, kinds]) => kinds.map((k) => [k, goal])));
/** Kinds that are a goal of their own even when they build on another persona's work. */
const OWN_GOAL = new Set(["doc.cowrite", "meet.call", "cal.rsvp", "gap"]);

export const goalOf = (kind) => GOAL_OF.get(kind) ?? "other";

/**
 * Chains of actions that serve one goal: an action joins the chain of the
 * action it depends on (a share joins its upload, a reply its message),
 * unless its kind is a goal of its own. The chain's goal and owner come from
 * its first action.
 */
export function goalChains(plan) {
  const parent = new Map();
  const find = (n) => {
    while (parent.get(n) !== n) n = parent.get(n);
    return n;
  };
  const byN = new Map(plan.actions.map((a) => [a.n, a]));
  for (const a of plan.actions) parent.set(a.n, a.n);
  for (const a of plan.actions) {
    if (OWN_GOAL.has(a.kind)) continue;
    for (const d of a.deps ?? []) {
      if (!byN.has(d) || OWN_GOAL.has(byN.get(d).kind)) continue;
      const [ra, rd] = [find(a.n), find(d)];
      if (ra !== rd) parent.set(Math.max(ra, rd), Math.min(ra, rd));
    }
  }
  const chains = new Map();
  for (const a of plan.actions) {
    const root = find(a.n);
    const c = chains.get(root) ?? chains.set(root, { root, goal: goalOf(byN.get(root).kind), persona: byN.get(root).persona, actions: [] }).get(root);
    c.actions.push(a.n);
  }
  return [...chains.values()];
}

/**
 * Per goal chain: steps, requests, retries, time, time spent waiting, input
 * (browser only), failures and friction. Per goal: medians and the share of
 * chains that ran into trouble (a failure, a retry or a friction record).
 */
export function measureNight({ plan, outcomes = [], requests = [], interactions = [], friction = [] }) {
  const out = new Map(outcomes.map((o) => [o.n, o]));
  const reqBy = groupBy(requests.filter((r) => r.action != null && r.layer !== "oracle" && r.layer !== "bootstrap" && !BACKGROUND.test(r.path)), (r) => r.action);
  const ixBy = new Map(interactions.map((i) => [i.n, i]));
  const frBy = groupBy(friction, (f) => f.n);
  const byN = new Map(plan.actions.map((a) => [a.n, a]));

  const chains = goalChains(plan).map((c) => {
    const ran = c.actions.filter((n) => out.get(n) && out.get(n).reason !== "filtered");
    const reqs = ran.flatMap((n) => reqBy.get(n) ?? []);
    const ix = ran.map((n) => ixBy.get(n)).filter(Boolean);
    const fr = ran.flatMap((n) => frBy.get(n) ?? []);
    const failures = ran.filter((n) => out.get(n).status === "failed").length;
    const skipped = ran.filter((n) => out.get(n).status === "skipped").length;
    const retries = reqs.filter((r) => r.retry).length;
    return {
      ...c,
      personas: [...new Set(ran.map((n) => byN.get(n).persona))],
      layers: [...new Set(ran.map((n) => byN.get(n).layer))],
      steps: ran.length,
      requests: reqs.length,
      retries,
      wallMs: ran.reduce((s, n) => s + (out.get(n).ms ?? 0), 0),
      waitMs: ix.reduce((s, i) => s + i.waits.reduce((t, w) => t + w.ms, 0), 0),
      input: ix.length ? ix.reduce((s, i) => s + i.clicks + i.keys, 0) : null,
      failures,
      skipped,
      friction: fr.length,
      trouble: failures > 0 || skipped > 0 || retries > 0 || fr.length > 0,
    };
  });

  const goals = {};
  for (const [goal, list] of groupBy(chains.filter((c) => c.steps > 0), (c) => c.goal)) {
    const ui = list.filter((c) => c.input != null);
    goals[goal] = {
      n: list.length,
      steps: median(list.map((c) => c.steps)),
      requests: median(list.map((c) => c.requests)),
      wallMs: median(list.map((c) => c.wallMs)),
      waitMs: ui.length ? median(ui.map((c) => c.waitMs)) : null,
      input: ui.length ? median(ui.map((c) => c.input)) : null,
      retries: sum(list, "retries"),
      failures: sum(list, "failures") + sum(list, "skipped"),
      friction: sum(list, "friction"),
      troubleRate: list.filter((c) => c.trouble).length / list.length,
      worst: [...list].sort(byCost)[0]?.root ?? null,
    };
  }

  const items = frictionItems({ plan, friction, chains });
  const screens = {};
  for (const [screen, list] of groupBy(interactions.flatMap((i) => i.screens), (s) => s.screen)) {
    const ms = list.map((s) => s.ms);
    screens[screen] = { n: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95) };
  }
  return { chains, goals, items, screens };
}

/**
 * Friction records grouped by what went wrong, plus the night's scripted gap
 * moments (from the corpus, so never a discovery). Ranked: observed before
 * scripted, then by how often, then by the goal time they sat in.
 */
export function frictionItems({ plan, friction, chains }) {
  const chainOf = new Map(chains.flatMap((c) => c.actions.map((n) => [n, c])));
  const records = [
    ...friction,
    ...plan.actions.filter((a) => a.kind === "gap").map((a) => ({ n: a.n, persona: a.persona, what: a.params.need, workaround: a.params.workaround, source: "scripted-gap" })),
  ];
  const items = new Map();
  for (const r of records) {
    const it = items.get(r.what) ?? items.set(r.what, { what: r.what, source: r.source, workaround: r.workaround, count: 0, personas: new Set(), actions: [], goals: new Set(), costMs: 0 }).get(r.what);
    it.count += 1;
    it.personas.add(r.persona);
    it.actions.push(r.n);
    const c = chainOf.get(r.n);
    if (c) {
      it.goals.add(c.goal);
      it.costMs += c.wallMs ?? 0;
    }
  }
  const rank = (s) => (s === "scripted-gap" ? 1 : 0);
  return [...items.values()]
    .map((it) => ({ ...it, personas: [...it.personas].sort(), goals: [...it.goals].sort(), actions: [...new Set(it.actions)].sort((a, b) => a - b) }))
    .sort((a, b) => rank(a.source) - rank(b.source) || b.count - a.count || b.costMs - a.costMs || (a.what < b.what ? -1 : 1));
}

/** Goals ranked by cost: share of chains in trouble, then median wait plus time. */
export function rankGoals(goals) {
  return Object.entries(goals).sort(([ga, a], [gb, b]) => b.troubleRate - a.troubleRate || (b.waitMs ?? 0) + b.wallMs - ((a.waitMs ?? 0) + a.wallMs) || (ga < gb ? -1 : 1));
}

/** Next friction history (kept in the data dir, so snapshots carry it) and the trend per goal against the 7-night median. */
export function frictionTrend(history, date, measured) {
  const prior = (history?.nights ?? []).filter((n) => n.date < date).slice(-7);
  const trend = {};
  for (const [goal, g] of Object.entries(measured.goals)) {
    const past = prior.map((n) => n.goals[goal]?.wallMs).filter((v) => v != null);
    const pastWait = prior.map((n) => n.goals[goal]?.waitMs).filter((v) => v != null);
    trend[goal] = {
      nights: past.length,
      wallMs: past.length >= 3 ? median(past) : null,
      waitMs: pastWait.length >= 3 ? median(pastWait) : null,
    };
  }
  const itemNights = {};
  for (const it of measured.items) itemNights[it.what] = 1 + prior.filter((n) => (n.items?.[it.what] ?? 0) > 0).length;
  const entry = {
    date,
    goals: Object.fromEntries(Object.entries(measured.goals).map(([g, v]) => [g, { n: v.n, wallMs: v.wallMs, waitMs: v.waitMs, troubleRate: v.troubleRate }])),
    items: Object.fromEntries(measured.items.map((it) => [it.what, it.count])),
  };
  return { trend, itemNights, nextHistory: { nights: [...(history?.nights ?? []).filter((n) => n.date !== date), entry].slice(-30) } };
}

function byCost(a, b) {
  return Number(b.trouble) - Number(a.trouble) || b.failures - a.failures || b.waitMs + b.wallMs - (a.waitMs + a.wallMs);
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)).push(x);
  }
  return m;
}

const sum = (list, field) => list.reduce((s, x) => s + (x[field] ?? 0), 0);
