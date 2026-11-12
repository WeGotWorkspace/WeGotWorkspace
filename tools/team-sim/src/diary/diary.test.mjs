import test from "node:test";
import assert from "node:assert/strict";
import { personaFacts, validateDiary, writeDiaries } from "./diary.mjs";
import { rankThemes, rankWeekFriction, weeklyDigest } from "./digest.mjs";

const people = { eva: { displayName: "Eva de Wit", title: "Designer" }, joost: { displayName: "Joost Bakker", title: "PM" } };
const world = { persona: (id) => { if (!people[id]) throw new Error(`unknown persona ${id}`); return people[id]; }, teamsOf: () => ["studio"], teams: [{ id: "studio", name: "Studio" }], zoneOf: () => "Europe/Amsterdam" };
const run = {
  plan: {
    actions: [
      { n: 1, persona: "eva", layer: "ui", kind: "note.create", minute: 5, params: { title: "Moodboard" } },
      { n: 2, persona: "joost", layer: "api", kind: "chat.post", minute: 7, params: { text: "Kick-off at 10" } },
      { n: 3, persona: "eva", layer: "ui", kind: "drive.upload", minute: 70, params: { name: "print.pdf" } },
    ],
  },
  outcomes: [
    { n: 1, status: "ok", ms: 3000 },
    { n: 2, status: "ok", ms: 100 },
    { n: 3, status: "failed", ms: 9000, error: "upload stalled" },
  ],
  interactions: [{ n: 3, persona: "eva", clicks: 4, keys: 0, failed: true, waits: [{ label: "upload finished", ms: 8000 }], screens: [{ screen: "drive", ms: 1200 }], shot: null }],
  friction: [{ n: 1, persona: "eva", what: "Notes before notebooks load are lost", workaround: "wait" }],
};
const reply = (o) => JSON.stringify(o);

test("facts hold only the persona's own actions", () => {
  const f = personaFacts({ world, date: "2026-11-12", persona: "eva", ...run });
  assert.deepEqual(f.actionNumbers, [1, 3]);
  assert.equal(f.actions[1].time, "10:10");
  assert.deepEqual(f.actions[1].waited, ["upload finished 8 s"]);
  assert.equal(f.friction.length, 1);
  assert.ok(!JSON.stringify(f).includes("Kick-off"), "another persona's action never leaks in");
});

test("validation drops items that cite someone else's actions and reports bad citations", () => {
  const f = personaFacts({ world, date: "2026-11-12", persona: "eva", ...run });
  const text = `Sure: ${reply({ diary: "My upload stalled again (#3). Joost posted the kick-off (#2).", items: [{ type: "frustration", text: "Upload stalled", actions: [3] }, { type: "wish", text: "x", actions: [2] }] })}`;
  const d = validateDiary(text, f);
  assert.deepEqual(d.check.invalid, [2]);
  assert.equal(d.items.length, 1);
  assert.equal(d.check.droppedItems, 1);
});

function fakeRunner({ cost = 0.05, fail = null } = {}) {
  const calls = [];
  return {
    model: "fake",
    calls,
    available: () => null,
    run: async ({ budgetUsd }) => {
      calls.push(budgetUsd);
      if (fail) {
        const e = new Error(fail);
        e.fatal = true;
        throw e;
      }
      return { text: reply({ diary: "Worked on it (#1).", items: [{ type: "went-well", text: "ok", actions: [1, 2, 3] }] }), costUsd: cost, tokens: 1000, ms: 10 };
    },
  };
}

test("diaries stop at the night's dollar cap", async () => {
  const runner = fakeRunner({ cost: 0.05 });
  const r = await writeDiaries({ world, date: "2026-11-12", run, measured: null, runner, budgetUsd: 0.055 });
  assert.equal(r.diaries.length, 1);
  assert.ok(runner.calls.every((b) => b <= 0.055));
  assert.match(r.notes[0], /cap of \$0\.06; no diary for joost/);
});

test("an unavailable or logged-out CLI skips the diaries and fails nothing", async () => {
  const missing = await writeDiaries({ world, date: "2026-11-12", run, runner: { model: "x", available: () => "the `claude` CLI is not available" } });
  assert.match(missing.skipped, /not available/);
  const loggedOut = await writeDiaries({ world, date: "2026-11-12", run, runner: fakeRunner({ fail: "Failed to authenticate" }) });
  assert.match(loggedOut.skipped, /Failed to authenticate/);
  assert.equal(loggedOut.diaries.length, 0);
});

const week = [
  { date: "2026-11-14", measure: { chains: [{ actions: [3], wallMs: 9000, waitMs: 8000 }], items: [{ what: "Uploads stall", source: "detected", actions: [3], personas: ["eva"], costMs: 9000 }, { what: "Hours", source: "scripted-gap", actions: [9], personas: ["eva", "joost"], costMs: 0 }] } },
  { date: "2026-11-15", measure: { chains: [{ actions: [5], wallMs: 1000, waitMs: 0 }], items: [{ what: "Uploads stall", source: "detected", actions: [5], personas: ["joost"], costMs: 1000 }] } },
];

test("week friction ranks observed items by persona-days, scripted gaps last", () => {
  const r = rankWeekFriction(week);
  assert.deepEqual(r.map((x) => [x.what, x.frequency]), [["Uploads stall", 2], ["Hours", 2]]);
  assert.deepEqual(r[0].evidence, ["2026-11-14 #3", "2026-11-15 #5"]);
});

test("themes are ranked here, not by the model's order", () => {
  const items = [
    { id: 1, date: "2026-11-14", persona: "eva", type: "slow", text: "Upload took ages", actions: [3] },
    { id: 2, date: "2026-11-15", persona: "joost", type: "frustration", text: "Upload stuck", actions: [5] },
    { id: 3, date: "2026-11-15", persona: "eva", type: "wish", text: "Time tracking", actions: [7] },
  ];
  const themes = [{ title: "Time tracking", kind: "opportunity", items: [3] }, { title: "Slow uploads", kind: "frustration", items: [1, 2, 3] }];
  const r = rankThemes(themes, items, week);
  assert.deepEqual(r.map((t) => t.title), ["Slow uploads", "Time tracking"]);
  assert.equal(r[0].frequency, 2);
  assert.equal(r[0].costMs, 18000);
  assert.deepEqual(r[1].evidence, ["2026-11-15 #7"], "an item counts in one theme only");
});

test("digest without diary items still ranks friction", async () => {
  const d = await weeklyDigest({ nights: week, date: "2026-11-15", runner: null });
  assert.match(d.skipped, /no diary items/);
  assert.equal(d.friction[0].what, "Uploads stall");
});

test("facts leave out outcome notes and anything the harness may have caused", () => {
  const plan = { actions: [...run.plan.actions, { n: 4, persona: "eva", layer: "ui", kind: "cal.event", minute: 80, params: { title: "Sync" } }, { n: 5, persona: "eva", layer: "api", kind: "cal.rsvp", minute: 90, params: {} }, { n: 6, persona: "eva", layer: "ui", kind: "note.edit", minute: 95, flags: { reload: true }, params: { append: "x" } }, { n: 7, persona: "eva", layer: "ui", kind: "meet.call", minute: 100, params: { guest: "Remco Dijkstra" } }] };
  const outcomes = [
    ...run.outcomes.map((o) => (o.n === 1 ? { ...o, note: "16 parts" } : o)),
    { n: 4, status: "failed", ms: 3000, error: "expected one new event", suspect: "harness" },
    { n: 5, status: "skipped", reason: "dependency #4 failed" },
    { n: 6, status: "ok", ms: 2000, note: "reloaded mid-action" },
    { n: 7, status: "ok", ms: 9000 },
  ];
  const f = personaFacts({ world, date: "2026-11-12", persona: "eva", ...run, plan, outcomes });
  const by = new Map(f.actions.map((a) => [a.n, a]));
  assert.ok(!JSON.stringify(f).includes("16 parts"), "outcome notes stay in the morning report");
  assert.match(by.get(4).result, /^unclear/);
  assert.equal(by.get(4).problem, undefined);
  assert.match(by.get(5).result, /^unclear/, "a skip behind a doubted failure is unclear too");
  assert.equal(by.get(6).situation, "reloaded the page in the middle of it");
  assert.equal(by.get(7).with, "Remco Dijkstra (guest)", "a guest is not looked up as a persona");
});
