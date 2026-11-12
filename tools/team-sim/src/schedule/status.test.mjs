import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { layout } from "../instance/config.mjs";
import { recordMissed, startedTooLate, status } from "./status.mjs";

const home = () => layout(mkdtempSync(join(tmpdir(), "sim-status-")));

test("status fails after two days without a night", () => {
  const paths = home();
  assert.equal(status({ paths, now: new Date("2026-11-12T08:00:00") }).ok, false, "no night yet");
  writeFileSync(paths.lastNight, JSON.stringify({ date: "2026-11-10", endedAt: new Date("2026-11-10T03:10:00").toISOString(), sha: "abc", report: "r.md" }));
  writeFileSync(paths.nightsLog, JSON.stringify([{ date: "2026-11-10", status: "done" }]));
  assert.equal(status({ paths, now: new Date("2026-11-11T08:00:00") }).ok, true);
  const late = status({ paths, now: new Date("2026-11-12T08:00:00") });
  assert.equal(late.ok, false);
  assert.match(late.text, /Missed: 2026-11-11/);
});

test("a run after 06:00 is skipped as missed", () => {
  assert.equal(startedTooLate(new Date("2026-11-12T02:30:00")), false);
  assert.equal(startedTooLate(new Date("2026-11-12T06:00:00")), true);
  assert.equal(startedTooLate(new Date("2026-11-12T13:00:00")), true);
  const paths = home();
  writeFileSync(paths.nightsLog, "[]");
  recordMissed(paths, "2026-11-12", "woke at 07:12");
  assert.deepEqual(JSON.parse(readFileSync(paths.nightsLog, "utf8")).map((n) => [n.date, n.status]), [["2026-11-12", "missed"]]);
});
