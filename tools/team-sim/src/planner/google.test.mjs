import test from "node:test";
import assert from "node:assert/strict";
import { loadWorld } from "../world/load.mjs";
import { planNight } from "./planner.mjs";
import { IMPORT_TYPES, PHONE_KINDS, assignDevices } from "./google.mjs";
import { createRng } from "./prng.mjs";

const world = loadWorld();
const snapshot = {
  objects: [
    { key: "doc:2026-11-10:3", type: "doc", scope: "studio", project: "vos", owner: "fatima", status: "active" },
    { key: "doc:2026-11-10:6", type: "doc", scope: "noordlicht", project: "noordlicht", owner: "eva", status: "active" },
    { key: "file:2026-11-10:5", type: "file", scope: "studio", project: "vos", owner: "daan", status: "active", bytes: 4000000 },
    { key: "file:2026-11-10:7", type: "file", scope: "noordlicht", project: "noordlicht", owner: "eva", status: "active", bytes: 4000000 },
  ],
  driveBytes: 8000000,
};
const WEEKDAY = "2026-11-18";

test("habits and imports are seeded: same inputs, same Google actions", () => {
  const a = planNight({ world, date: WEEKDAY, snapshot });
  const b = planNight({ world: loadWorld(), date: WEEKDAY, snapshot: structuredClone(snapshot) });
  const google = (p) => p.actions.filter((x) => x.kind === "habit" || x.kind === "migrate.import");
  assert.deepEqual(google(a), google(b));
  const habits = google(a).filter((x) => x.kind === "habit");
  assert.ok(habits.length >= 4 && habits.length <= 6, `${habits.length} habits`);
  assert.equal(new Set(habits.map((x) => x.persona)).size, habits.length, "at most one habit per persona");
  for (const h of habits) assert.ok(world.persona(h.persona).habits.includes(h.params.habit), `${h.persona} has habit ${h.params.habit}`);
});

test("--habits all plans every habit it can and every import type once, and changes the hash", () => {
  const all = planNight({ world, date: WEEKDAY, snapshot, options: { habits: "all" } });
  const plain = planNight({ world, date: WEEKDAY, snapshot });
  assert.notEqual(all.hash, plain.hash);
  assert.deepEqual(all.options, { habits: "all" });
  const types = all.actions.filter((x) => x.kind === "migrate.import").map((x) => x.params.type).sort();
  assert.deepEqual(types, [...IMPORT_TYPES].sort());
  const habits = new Set(all.actions.filter((x) => x.kind === "habit").map((x) => x.params.habit));
  for (const h of ["mention-assign", "team-share", "find-a-time", "meet-in-invite", "expiring-link", "folder-drop"]) assert.ok(habits.has(h), `habit ${h} planned`);
});

test("browser-only habits go to browser personas, and an import's layer follows the persona's apps", () => {
  for (const date of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) {
    const plan = planNight({ world, date, snapshot, options: { habits: "all" } });
    for (const a of plan.actions.filter((x) => x.kind === "habit")) {
      const layers = world.habit(a.params.habit).layers;
      if (a.layer === "dav") assert.equal(world.appMode(a.persona, a.app), "native", `${date} #${a.n} ${a.params.habit} in a native app`);
      else assert.ok(layers.includes(a.layer), `${date} #${a.n} ${a.params.habit} on ${a.layer}`);
      if (a.layer === "ui") assert.ok(plan.ui.includes(a.persona));
      if (a.params.habit === "suggest-edit") assert.notEqual(a.params.author, a.persona);
    }
    for (const a of plan.actions.filter((x) => x.kind === "migrate.import")) {
      if (a.layer === "dav") assert.equal(world.appMode(a.persona, a.app), "native", `${date} #${a.n} ${a.params.type}`);
      if (a.params.type === "docx" && plan.ui.some((p) => plan.present.includes(p))) assert.equal(a.layer, "ui", `${date}: a .docx becomes a doc in the browser`);
    }
  }
});

test("native apps take Calendar, Contacts and Tasks actions for their personas", () => {
  const plan = planNight({ world, date: WEEKDAY, snapshot });
  for (const a of plan.actions.filter((x) => x.layer === "dav")) {
    assert.ok(["apple", "davx5"].includes(a.client), `#${a.n} has a client`);
    if (a.client === "davx5") assert.equal(world.persona(a.persona).devices.phone, "android");
  }
  const native = plan.actions.filter((x) => x.layer === "dav" && x.persona === "joost");
  assert.ok(native.length > 0, "joost keeps Apple's apps");
});

test("devices: only phone kinds run on a phone, in the persona's own phone browser", () => {
  const actions = [];
  for (let i = 0; i < 60; i += 1) actions.push({ n: i + 1, persona: i % 2 ? "tom" : "priya", layer: "ui", kind: i % 3 ? "chat.post" : "doc.edit" });
  const out = assignDevices(actions, { world, rng: createRng("devices-test") });
  assert.ok(out.some((a) => a.device === "phone"), "some actions on a phone");
  for (const a of out) {
    if (a.device === "phone") {
      assert.ok(PHONE_KINDS.has(a.kind));
      assert.equal(a.browser, world.persona(a.persona).devices.phone === "android" ? "android" : "iphone");
    } else assert.equal(a.browser, world.persona(a.persona).devices.browser);
  }
  assert.deepEqual(out, assignDevices(actions, { world, rng: createRng("devices-test") }));
});
