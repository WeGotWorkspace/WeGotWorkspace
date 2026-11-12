import test from "node:test";
import assert from "node:assert/strict";
import { loadWorld } from "../world/load.mjs";
import { planNight } from "./planner.mjs";
import { addDays, isWeekend } from "./dates.mjs";
import { uiPersonasFor } from "./roster.mjs";
import { createRng } from "./prng.mjs";

const world = loadWorld();
const snapshot = {
  objects: [
    { key: "doc:2026-11-10:3", type: "doc", scope: "studio", project: "vos", owner: "fatima", status: "active" },
    { key: "task:2026-11-10:4", type: "task", scope: "studio", project: "vos", owner: "sanne", status: "open" },
    { key: "file:2026-11-10:5", type: "file", scope: "studio", project: "vos", owner: "daan", status: "active", bytes: 4000000 },
  ],
  driveBytes: 4000000,
};

test("same world, seed and snapshot give the same action-list hash", () => {
  const a = planNight({ world, date: "2026-11-12", snapshot });
  const b = planNight({ world: loadWorld(), date: "2026-11-12", snapshot: structuredClone(snapshot) });
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.actions, b.actions);
  assert.notEqual(a.hash, planNight({ world, date: "2026-11-13", snapshot }).hash);
  assert.notEqual(a.hash, planNight({ world, date: "2026-11-12", snapshot: { objects: [], driveBytes: 0 } }).hash);
});

test("dependencies point backwards and name existing actions", () => {
  for (const date of ["2026-11-12", "2026-11-24", "2026-12-15", "2027-01-12"]) {
    const plan = planNight({ world, date, snapshot });
    for (const a of plan.actions) {
      for (const d of a.deps) {
        assert.ok(d < a.n, `${date} action ${a.n} depends on later ${d}`);
        assert.ok(plan.actions[d - 1].minute <= a.minute);
      }
    }
  }
});

test("a reply depends on its message and a share on its file", () => {
  const plan = planNight({ world, date: "2026-12-15", snapshot });
  const byN = new Map(plan.actions.map((a) => [a.n, a]));
  for (const a of plan.actions) {
    if (a.kind === "chat.reply" && a.deps.length) assert.equal(byN.get(a.deps[0]).creates, a.params.parent);
    if (a.kind === "drive.share" && a.deps.length) assert.equal(byN.get(a.deps[0]).creates, a.params.file);
  }
});

test("weekends produce the light plan", () => {
  const sat = planNight({ world, date: "2026-11-14", snapshot });
  const wed = planNight({ world, date: "2026-11-18", snapshot });
  assert.ok(sat.light && !wed.light);
  assert.ok(sat.present.length <= world.rhythm.weekendActivePersonas);
  assert.ok(sat.actions.length < wed.actions.length / 4);
});

test("Lotte is off on Wednesday and Tom is not created before week 4", () => {
  const wed = planNight({ world, date: "2026-11-18", snapshot });
  assert.equal(wed.absent.lotte, "day-off");
  assert.ok(!wed.actions.some((a) => a.persona === "lotte"));
  assert.ok(!planNight({ world, date: "2026-11-27", snapshot }).actions.some((a) => a.persona === "tom"));
});

test("sick days and holidays come from the seed", () => {
  const nights = Array.from({ length: 60 }, (_, i) => planNight({ world, date: addDays("2026-11-16", i), snapshot }));
  assert.ok(nights.some((n) => Object.values(n.absent).includes("sick")));
  assert.equal(nights.find((n) => n.date === "2026-11-26").absent.eva, "holiday");
  assert.deepEqual(planNight({ world, date: "2026-11-20", snapshot }).absent, planNight({ world, date: "2026-11-20", snapshot }).absent);
});

test("UI rotation picks 3 or 4 personas and covers everyone in any 7 nights", () => {
  const everyone = world.personas.map((p) => p.id);
  for (let start = 0; start < 40; start += 1) {
    const seen = new Set();
    for (let i = 0; i < 7; i += 1) {
      const date = addDays("2026-11-30", start + i);
      if (isWeekend(date)) continue;
      const ui = uiPersonasFor(world, date, everyone, createRng(i));
      assert.ok(ui.length === 3 || ui.length === 4);
      ui.forEach((p) => seen.add(p));
    }
    assert.equal(seen.size, everyone.length, `window from ${addDays("2026-11-30", start)}`);
  }
});

test("every app is used through both layers on a weekday", () => {
  for (const date of ["2026-11-12", "2026-11-24", "2026-12-15"]) {
    const plan = planNight({ world, date, snapshot });
    for (const app of ["chat", "docs", "notes", "tasks", "calendar", "contacts", "drive", "meet"]) {
      assert.ok(plan.actions.some((a) => a.app === app && a.layer === "ui"), `${date} ${app} ui`);
      assert.ok(plan.actions.some((a) => a.app === app && ["api", "dav"].includes(a.layer)), `${date} ${app} api`);
    }
  }
});

test("the DAV-only persona never uses the web calendar", () => {
  for (let i = 0; i < 20; i += 1) {
    const plan = planNight({ world, date: addDays("2026-11-12", i), snapshot });
    for (const a of plan.actions.filter((x) => x.persona === "joost" && ["calendar", "contacts"].includes(x.app))) {
      assert.equal(a.layer, "dav", `${a.kind} on ${plan.date}`);
    }
  }
});

test("gap moments are actions of kind gap with the workaround named", () => {
  const gaps = Array.from({ length: 10 }, (_, i) => planNight({ world, date: addDays("2026-11-16", i), snapshot }))
    .flatMap((p) => p.actions.filter((a) => a.kind === "gap"));
  assert.ok(gaps.length > 0);
  for (const g of gaps) assert.ok(g.params.need && g.params.workaround);
});

test("uploads stop at the Drive cap and closing a project deletes print files", () => {
  const full = { ...snapshot, driveBytes: world.meta.driveCapBytes - 1000 };
  const plan = planNight({ world, date: "2026-12-15", snapshot: full });
  assert.ok(!plan.actions.some((a) => a.kind === "drive.upload"));
  const closing = {
    objects: [{ key: "file:2027-01-05:1", type: "file", scope: "studio", project: "vos", owner: "eva", status: "active", size: "print", bytes: 5e8 }],
    driveBytes: 5e8,
  };
  const deletes = Array.from({ length: 5 }, (_, i) => planNight({ world, date: addDays("2027-01-11", i), snapshot: closing }))
    .flatMap((p) => p.actions.filter((a) => a.kind === "drive.delete"));
  assert.ok(deletes.some((a) => a.params.file === "file:2027-01-05:1"));
});
