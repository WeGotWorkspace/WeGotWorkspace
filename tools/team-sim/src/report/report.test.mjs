import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { oracleResult } from "../oracles/result.mjs";
import { missedNights, renderReport } from "./report.mjs";

const plan = { present: ["eva", "joost"], ui: ["eva"], absent: { lotte: "day-off" }, hash: "abc", worldVersion: 1 };
const section = (md, title) => {
  const start = md.indexOf(`## ${title}`);
  const next = md.indexOf("\n## ", start + 3);
  return md.slice(start, next < 0 ? undefined : next);
};

test("visibility failures render only in the private section", () => {
  const vis = oracleResult("visibility", { privateClass: true, failures: [{ detail: "lotte lists Business channel Pipeline", persona: "lotte", signature: "visibility:channel-list:business" }] });
  const { markdown } = renderReport({ date: "2026-11-12", plan, results: [vis] });
  assert.ok(section(markdown, "Private").includes("Business channel Pipeline"));
  const outside = markdown.replace(section(markdown, "Private"), "");
  assert.ok(!outside.includes("Pipeline"), "nothing about the finding outside Private");
});

test("product pains render only in the product section", () => {
  const gap = oracleResult("gap", { product: [{ persona: "sanne", need: "Log hours per project", workaround: "Spreadsheet" }] });
  const { markdown } = renderReport({ date: "2026-11-12", plan, results: [gap] });
  assert.ok(section(markdown, "Product").includes("Log hours per project"));
  assert.ok(!markdown.replace(section(markdown, "Product"), "").includes("Log hours"));
});

test("flaky failure moves to file-now on the third night", () => {
  const fail = () => [oracleResult("errors", { failures: [{ detail: "POST /api/v1/notes → 500", signature: "errors:POST /notes:500" }] })];
  let flaky = {};
  const nights = ["2026-11-12", "2026-11-13", "2026-11-16"];
  const reports = nights.map((date) => {
    const r = renderReport({ date, plan, results: fail(), flaky });
    flaky = r.nextFlaky;
    return r.markdown;
  });
  assert.ok(!reports[0].includes("## File now"));
  assert.ok(!reports[1].includes("## File now"));
  assert.ok(section(reports[2], "File now").includes("errors:POST /notes:500"));
});

test("a known issue is reported as blocked-by instead of a new failure", () => {
  const results = [oracleResult("errors", { failures: [{ detail: "x", signature: "errors:GET /drive:500" }] })];
  const { markdown } = renderReport({ date: "2026-11-12", plan, results, known: [{ match: "GET /drive", issue: 1234 }] });
  assert.match(section(markdown, "Known issues"), /blocked-by #1234/);
  assert.match(section(markdown, "Failures"), /None\./);
});

test("nights without a run are listed", () => {
  const log = [{ date: "2026-11-09", status: "ok" }, { date: "2026-11-10", status: "ok" }];
  assert.deepEqual(missedNights(log, "2026-11-13"), ["2026-11-11", "2026-11-12"]);
  const { markdown } = renderReport({ date: "2026-11-13", plan, results: [], nightsLog: log });
  assert.match(markdown, /\*\*Missed nights:\*\* 2026-11-11, 2026-11-12/);
});

test("report module has no network client", () => {
  for (const file of readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/\bfetch\(|node:https?|node:net|node:tls|child_process|from "\.\.\/client|\bgh\b/.test(src), `${file} must not reach the network`);
  }
});
