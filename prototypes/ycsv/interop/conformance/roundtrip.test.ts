// Round-trip properties for both implementations (spike 11).
//  P1 data:  parse(serialize(sheet)).rows == sheet.rows
//  P2 bytes: serialize(parse(serialize(sheet))) == serialize(sheet)   (byte-stable)
//  P3 corpus idempotence: rt(rt(file)) == rt(file) for every corpus file that parses
// Results (pass, or the shrunk counterexample) go to roundtrip-results.json; the test fails
// only if the harness itself breaks, because the point is to report, not to gate.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { expect, test } from "vitest";
import { parseYcsv, serializeYcsv, type ParsedWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv";
import { parse as protoParse, serialize as protoSerialize } from "../../src/ycsv-core";
import { coreImpl } from "../adapters/core";
import { protoImpl } from "../adapters/proto";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Cells: mostly ordinary, with every hazard the CSV/YCSV layer has to survive.
const hazard = fc.constantFrom("", " ", ",", '"', "\n", "\r\n", "\r", "---", "\n---\n", "=1+1", "'", "é", "😀", "\t", "0", "007", "-");
const cell = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 6 }) },
  { weight: 2, arbitrary: hazard },
  { weight: 1, arbitrary: fc.array(hazard, { maxLength: 4 }).map((xs) => xs.join("x")) },
);

const sheetArb = fc.integer({ min: 1, max: 4 }).chain((width) =>
  fc.record({
    refs: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/).filter((r) => !["true", "false", "null", "and", "or", "not"].includes(r)), {
      minLength: width,
      maxLength: width,
    }),
    rows: fc.array(fc.array(cell, { minLength: width, maxLength: width }), { maxLength: 5 }),
  }),
);

function coreWorkbook(s: { refs: string[]; rows: string[][] }): ParsedWorkbook {
  return {
    version: 1,
    defs: {},
    warnings: [],
    sheets: [
      {
        ref: "sheet1",
        name: "sheet1",
        columnSettings: s.refs.map((ref) => ({ ref, name: ref, refExplicit: true })),
        defs: {},
        refs: s.refs,
        headers: s.refs,
        rows: s.rows,
        hadHeader: true,
      },
    ],
  };
}

const coreSer = (s: { refs: string[]; rows: string[][] }) => serializeYcsv(coreWorkbook(s));
const protoSer = (s: { refs: string[]; rows: string[][] }) =>
  protoSerialize({ frontmatter: { ycsv_version: 1, columns: s.refs.map((ref) => ({ ref })) }, columns: s.refs.map((ref) => ({ ref })), header: s.refs, rows: s.rows });

type Outcome = { property: string; impl: string; ok: boolean; runs: number; counterexample?: unknown };

function check(property: string, impl: string, prop: fc.IProperty<[{ refs: string[]; rows: string[][] }]>): Outcome {
  const out = fc.check(prop, { numRuns: 400, seed: 11 });
  return { property, impl, ok: !out.failed, runs: out.numRuns, counterexample: out.failed ? out.counterexample?.[0] : undefined };
}

test("round-trip properties", () => {
  const outcomes: Outcome[] = [];

  outcomes.push(
    check("P1 data survives", "core", fc.property(sheetArb, (s) => {
      const back = parseYcsv(coreSer(s)).sheets[0]!;
      return JSON.stringify(back.rows) === JSON.stringify(s.rows);
    })),
    check("P2 byte-stable", "core", fc.property(sheetArb, (s) => {
      const once = coreSer(s);
      return serializeYcsv(parseYcsv(once)) === once;
    })),
    check("P1 data survives", "proto", fc.property(sheetArb, (s) => {
      const back = protoParse(protoSer(s));
      return JSON.stringify(back.rows) === JSON.stringify(s.rows);
    })),
    check("P2 byte-stable", "proto", fc.property(sheetArb, (s) => {
      const once = protoSer(s);
      return protoSerialize(protoParse(once)) === once;
    })),
  );

  // Same properties restricted to "plain" cells (no CR, no line that is exactly ---, no
  // leading =): what a careful writer can guarantee today.
  const plain = (v: string) => !v.includes("\r") && !/(^|\n)---(\n|$)/.test(v) && !v.startsWith("=");
  const noEmptyRows = (s: { rows: string[][] }) => s.rows.every((r) => r.some((c) => c !== ""));
  const hazardSheet = sheetArb.filter(noEmptyRows);
  const noSep = (v: string) => !/(^|\n|\r)---(\r?\n|$)/.test(v);
  const crSheet = sheetArb.filter((s) => noEmptyRows(s) && s.rows.every((r) => r.every(noSep)));
  outcomes.push(
    check("P1 data survives (no all-empty rows, no --- lines)", "core", fc.property(crSheet, (s) => JSON.stringify(parseYcsv(coreSer(s)).sheets[0]!.rows) === JSON.stringify(s.rows))),
    check("P1 data survives (no all-empty rows, no --- lines)", "proto", fc.property(crSheet, (s) => JSON.stringify(protoParse(protoSer(s)).rows) === JSON.stringify(s.rows))),
  );
  const plainSheet = sheetArb.filter((s) => noEmptyRows(s) && s.rows.every((r) => r.every(plain)));
  outcomes.push(
    check("P1 data survives (no all-empty rows)", "core", fc.property(hazardSheet, (s) => JSON.stringify(parseYcsv(coreSer(s)).sheets[0]!.rows) === JSON.stringify(s.rows))),
    check("P1 data survives (no all-empty rows)", "proto", fc.property(hazardSheet, (s) => JSON.stringify(protoParse(protoSer(s)).rows) === JSON.stringify(s.rows))),
    check("P2 byte-stable (no all-empty rows)", "core", fc.property(hazardSheet, (s) => { const once = coreSer(s); return serializeYcsv(parseYcsv(once)) === once; })),
    check("P2 byte-stable (no all-empty rows)", "proto", fc.property(hazardSheet, (s) => { const once = protoSer(s); return protoSerialize(protoParse(once)) === once; })),
  );
  outcomes.push(
    check("P1 data survives (plain cells, no all-empty rows)", "core", fc.property(plainSheet, (s) => JSON.stringify(parseYcsv(coreSer(s)).sheets[0]!.rows) === JSON.stringify(s.rows))),
    check("P1 data survives (plain cells, no all-empty rows)", "proto", fc.property(plainSheet, (s) => JSON.stringify(protoParse(protoSer(s)).rows) === JSON.stringify(s.rows))),
  );

  // P3: corpus idempotence + whether the canonical writer reproduces the corpus file.
  const corpus = readdirSync(here("./corpus")).filter((f) => f.endsWith(".ycsv")).sort();
  const p3: Record<string, { core: string; proto: string }> = {};
  for (const f of corpus) {
    const text = readFileSync(here(`./corpus/${f}`), "utf8");
    const row = { core: "", proto: "" };
    for (const impl of [coreImpl, protoImpl]) {
      const once = impl.roundTrip(text);
      if (once === null) row[impl.id] = "does not parse";
      else {
        const twice = impl.roundTrip(once);
        row[impl.id] = twice !== once ? "NOT idempotent" : once === text ? "byte-identical" : "stable after 1st write";
      }
    }
    p3[f.replace(/\.ycsv$/, "")] = row;
  }

  writeFileSync(here("./roundtrip-results.json"), `${JSON.stringify({ properties: outcomes, corpus: p3 }, null, 2)}\n`);
  expect(outcomes.length).toBe(12);
}, 120_000);
