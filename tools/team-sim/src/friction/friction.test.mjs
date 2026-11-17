import test from "node:test";
import assert from "node:assert/strict";
import { frictionTrend, goalChains, measureNight, rankGoals } from "./measure.mjs";
import { voiceLines } from "../report/voice.mjs";

const plan = {
  actions: [
    { n: 1, persona: "eva", layer: "api", kind: "drive.upload", deps: [] },
    { n: 2, persona: "eva", layer: "api", kind: "drive.share", deps: [1] },
    { n: 3, persona: "joost", layer: "api", kind: "drive.guestDownload", deps: [2] },
    { n: 4, persona: "joost", layer: "ui", kind: "doc.cowrite", deps: [1] },
    { n: 5, persona: "lotte", layer: "ui", kind: "note.create", deps: [] },
    { n: 6, persona: "lotte", layer: "none", kind: "gap", params: { need: "Log hours per project", workaround: "Spreadsheet" }, deps: [] },
  ],
};
const outcomes = [
  { n: 1, status: "ok", ms: 4000 },
  { n: 2, status: "ok", ms: 200 },
  { n: 3, status: "failed", ms: 900 },
  { n: 4, status: "ok", ms: 12000 },
  { n: 5, status: "ok", ms: 3000 },
  { n: 6, status: "ok", ms: 0 },
];
const requests = [
  { action: 1, path: "/dav/files/eva/a.png", layer: "api" },
  { action: 1, path: "/dav/files/eva/a.png", layer: "api", retry: "429" },
  { action: 4, path: "/api/v1/rooms/r1/events", layer: "ui" },
  { action: 4, path: "/api/v1/docs/d1", layer: "ui" },
  { action: 2, path: "/api/v1/shares", layer: "oracle" },
];
const interactions = [
  { n: 4, persona: "joost", ms: 12000, failed: false, clicks: 2, keys: 40, waits: [{ label: "co-writer joined", ms: 5000 }], screens: [{ screen: "docs", ms: 1800 }] },
  { n: 5, persona: "lotte", ms: 3000, failed: false, clicks: 3, keys: 20, waits: [], screens: [{ screen: "notes", ms: 900 }] },
];
const friction = [
  { n: 4, persona: "joost", what: "Typing right after opening a shared doc can be lost", workaround: "wait for the co-writer", source: "actor-workaround" },
  { n: 5, persona: "lotte", what: "New note before notebooks load is never saved", workaround: "wait for the list", source: "actor-workaround" },
  { n: 1, persona: "eva", what: "New note before notebooks load is never saved", source: "detected" },
];

test("chains follow deps but goals of their own stay apart", () => {
  const chains = goalChains(plan);
  const upload = chains.find((c) => c.root === 1);
  assert.deepEqual(upload.actions, [1, 2, 3]);
  assert.equal(upload.goal, "hand off a file");
  assert.equal(chains.find((c) => c.root === 4).goal, "co-write a doc", "cowrite does not join the upload's chain");
});

test("measure counts steps, retries, waits and input, and skips background and oracle requests", () => {
  const m = measureNight({ plan, outcomes, requests, interactions, friction });
  const upload = m.chains.find((c) => c.root === 1);
  assert.equal(upload.steps, 3);
  assert.equal(upload.requests, 2, "oracle request left out");
  assert.equal(upload.retries, 1);
  assert.equal(upload.failures, 1);
  assert.equal(upload.wallMs, 5100);
  const cowrite = m.chains.find((c) => c.root === 4);
  assert.equal(cowrite.requests, 1, "room events polling is background");
  assert.equal(cowrite.waitMs, 5000);
  assert.equal(cowrite.input, 42);
  assert.equal(m.goals["hand off a file"].troubleRate, 1);
  assert.equal(m.screens.docs.p50, 1800);
});

test("friction items: observed before scripted gaps, then by count", () => {
  const m = measureNight({ plan, outcomes, requests, interactions, friction });
  assert.deepEqual(m.items.map((i) => i.what), ["New note before notebooks load is never saved", "Typing right after opening a shared doc can be lost", "Log hours per project"]);
  assert.deepEqual(m.items[0].actions, [1, 5]);
  assert.deepEqual(m.items[0].personas, ["eva", "lotte"]);
  assert.equal(m.items.at(-1).source, "scripted-gap");
});

test("goals rank by trouble share, then cost", () => {
  const m = measureNight({ plan, outcomes, requests, interactions, friction });
  const order = rankGoals(m.goals).map(([g]) => g);
  assert.equal(order.at(-1), "do something the suite cannot");
  assert.ok(order.indexOf("co-write a doc") < order.indexOf("hand off a file"), "same trouble share: the costlier goal first");
});

test("trend needs three earlier nights and the history replaces tonight's entry", () => {
  const m = measureNight({ plan, outcomes, requests, interactions, friction });
  let history = { nights: [] };
  for (const d of ["2026-11-09", "2026-11-10"]) history = frictionTrend(history, d, m).nextHistory;
  assert.equal(frictionTrend(history, "2026-11-11", m).trend["hand off a file"].wallMs, null);
  history = frictionTrend(history, "2026-11-11", m).nextHistory;
  const t = frictionTrend(history, "2026-11-12", m);
  assert.equal(t.trend["hand off a file"].wallMs, 5100);
  assert.equal(t.itemNights["Log hours per project"], 4);
  const again = frictionTrend(t.nextHistory, "2026-11-12", m).nextHistory;
  assert.equal(again.nights.length, 4, "re-running a night does not add a night");
});

test("team voice flags a jump against the 7-night median and cites evidence", () => {
  const m = measureNight({ plan, outcomes, requests, interactions, friction });
  const trend = { "co-write a doc": { nights: 5, wallMs: 4000, waitMs: 1000 } };
  const md = voiceLines({ date: "2026-11-12", measure: { ...m, trend, itemNights: {} }, diary: { skipped: "Diaries skipped: no CLI.", diaries: [], notes: [] } }).join("\n");
  assert.match(md, /flagged: co-write a doc: 12\.0 s against a 7-night median of 4\.0 s/);
  assert.match(md, /evidence: #1, #5/);
  assert.match(md, /Diaries skipped: no CLI/);
});

test("a failure the harness may have caused is not the persona's trouble", () => {
  const doubted = outcomes.map((o) => (o.n === 3 ? { ...o, suspect: "harness" } : o));
  const upload = measureNight({ plan, outcomes: doubted, requests, interactions, friction }).chains.find((c) => c.root === 1);
  assert.equal(upload.failures, 0);
  assert.equal(upload.doubts, 1);
});

test("since Google: a habit works only without friction or failure; an import that loses content failed", () => {
  const g = {
    actions: [
      { n: 1, persona: "maarten", layer: "api", kind: "habit", app: "calendar", params: { habit: "find-a-time" } },
      { n: 2, persona: "priya", layer: "api", kind: "habit", app: "calendar", params: { habit: "meet-in-invite" } },
      { n: 3, persona: "fatima", layer: "ui", kind: "migrate.import", app: "docs", browser: "iphone", device: "phone", params: { type: "docx" } },
      { n: 4, persona: "joost", layer: "dav", kind: "migrate.import", app: "calendar", client: "apple", device: "desk", params: { type: "ics" } },
    ],
  };
  const out = [
    { n: 1, status: "ok", ms: 900 },
    { n: 2, status: "ok", ms: 700 },
    { n: 3, status: "ok", ms: 6000 },
    { n: 4, status: "failed", ms: 500, error: "lost the stand-up's weekly recurrence" },
  ];
  const fr = [
    { n: 1, persona: "maarten", what: "Colleagues' free time is hidden", workaround: "asked in chat", source: "habit" },
    { n: 3, persona: "fatima", what: "Comments are dropped", source: "migration" },
  ];
  const ix = [{ n: 3, persona: "fatima", browser: "safari", device: "desk", clicks: 4, keys: 0, waits: [], screens: [{ screen: "/docs", ms: 1500 }] }];
  const m = measureNight({ plan: g, outcomes: out, friction: fr, interactions: ix });
  assert.deepEqual([m.google.habits["find-a-time"].worked, m.google.habits["meet-in-invite"].worked], [0, 1]);
  assert.equal(m.google.imports.docx.worked, 0);
  assert.equal(m.google.imports.ics.failed, 1);
  assert.match(m.google.imports.ics.lost[0], /^#4: lost the stand-up/);
  assert.ok(m.goals["work the Google way"] && m.goals["bring old files over"]);
  // The browser it really ran in wins over the planned one.
  assert.ok(m.devices.some((r) => r.device === "Safari on the Mac" && r.app === "docs"));
  assert.ok(m.devices.some((r) => r.device === "Apple apps on the Mac" && r.failed === 1 && r.failures[0] === 4));
  const text = voiceLines({ date: "2026-11-18", measure: m }).join("\n");
  assert.match(text, /### Since Google/);
  assert.match(text, /\| find-a-time \| Find a time in Calendar \| 1 \| 0 \|/);
  assert.match(text, /\| ics \| 1 \| 0 \| #4: lost the stand-up's weekly recurrence/);
  assert.match(text, /### Devices/);
  assert.doesNotMatch(text, /API \(no screen\)/);
});

test("the habit trend counts the last 7 nights a habit was tried", () => {
  const night = (date, worked) => ({ date, goals: {}, items: {}, habits: { "find-a-time": { tries: 1, worked } } });
  const history = { nights: [night("2026-11-10", 0), night("2026-11-11", 1), night("2026-11-12", 1)] };
  const { habitTrend, nextHistory } = frictionTrend(history, "2026-11-13", { goals: {}, items: [], google: { habits: { "find-a-time": { tries: 2, worked: 2 } }, imports: {} } });
  assert.deepEqual(habitTrend["find-a-time"], { nights: 3, tries: 3, worked: 2 });
  assert.deepEqual(nextHistory.nights.at(-1).habits, { "find-a-time": { tries: 2, worked: 2 } });
});
