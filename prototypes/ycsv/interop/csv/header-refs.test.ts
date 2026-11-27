import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { a1ToYcsv, colLetters, ycsvToA1 } from "../xlsx/translate";
import { cellRef, headerRefs } from "./header-refs";

const sheet = (refs: string[]) => ({ sheets: [{ name: "s", ref: "s", refs }], self: 0, names: new Map<string, string>() });
const refsOf = (h: string[]) => headerRefs(h).columns.map((c) => c.ref);

/** Every column with a ref: A1 → YCSV gives cellRef, and YCSV → A1 gives the letter back. */
function roundTrip(header: string[]) {
  const { columns } = headerRefs(header);
  const refs = columns.map((c) => c.ref ?? ""); // a column without a ref has none
  const bad: string[] = [];
  for (const c of columns) {
    if (!c.ref) continue;
    const a1 = `${colLetters(c.index)}3`;
    const y = a1ToYcsv(a1, sheet(refs)).text;
    const back = ycsvToA1(y, sheet(refs)).text;
    if (y !== cellRef(c.ref, 3) || back !== a1) bad.push(`${JSON.stringify(c.ref)}: ${a1} → ${y} → ${back}`);
  }
  return bad;
}

describe("refs from the header text alone (P33 H1–H6)", () => {
  test.each<[string, string[], (string | null)[], string[]]>([
    // [case, header, refs, formula text for row 3 of each column with a ref]
    ["hand-typed identifiers", ["product", "prijs", "aantal"], ["product", "prijs", "aantal"], ["product3", "prijs3", "aantal3"]],
    ["display text with spaces and dots", ["Prijs incl. BTW"], ["Prijs incl. BTW"], ["'Prijs incl. BTW'3"]],
    ["ends in a digit: kw1 + row 2 is not kw12", ["kw1", "kw2"], ["kw1", "kw2"], ["'kw1'3", "'kw2'3"]],
    ["A1 look-alike Q1", ["Q1"], ["Q1"], ["'Q1'3"]],
    ["non-ASCII letters stay bare", ["categorieën", "Größe", "数量"], ["categorieën", "Größe", "数量"], ["categorieën3", "Größe3", "数量3"]],
    ["apostrophe doubled", ["Jan's uren"], ["Jan's uren"], ["'Jan''s uren'3"]],
    ["whitespace folded", ["  BTW   tarief "], ["BTW tarief"], ["'BTW tarief'3"]],
    ["empty header cell: letter", ["product", "", "prijs"], ["product", "B", "prijs"], ["product3", "B3", "prijs3"]],
    ["duplicates: neither gets the name", ["naam", "Naam", "plaats"], ["A", "B", "plaats"], ["A3", "B3", "plaats3"]],
    ["letter taken by a header: no ref", ["", "A"], [null, "A"], ["A3"]],
  ])("%s", (_, header, refs, formulas) => {
    const r = headerRefs(header);
    expect(r.columns.map((c) => c.ref)).toEqual(refs);
    expect(r.columns.filter((c) => c.ref).map((c) => cellRef(c.ref!, 3))).toEqual(formulas);
    expect(roundTrip(header)).toEqual([]);
  });

  test("losing a name is never silent", () => {
    expect(headerRefs(["naam", "naam"]).warnings).toHaveLength(2);
    expect(headerRefs(["", "A"]).warnings[0]).toContain("no ref");
    expect(headerRefs(["product", "prijs"]).warnings).toEqual([]);
  });

  test("case-insensitive in formulas: prijs3 finds header Prijs", () => {
    expect(ycsvToA1("prijs3*2", sheet(refsOf(["Product", "Prijs"]) as string[])).text).toBe("B3*2");
  });

  test("renaming a header in the source breaks formulas that use the old name", () => {
    // =prijs3 written against header "prijs"; someone renames the header to "stukprijs" by hand.
    const r = ycsvToA1("prijs3", sheet(refsOf(["product", "stukprijs"]) as string[]));
    expect(r.text).toBe("#REF!");
    expect(r.issues[0]!.what).toContain("unknown column ref prijs");
  });

  test("corpus: every header row in the fixtures round-trips", () => {
    const dirs = [fileURLToPath(new URL("../fixtures/out/", import.meta.url)), fileURLToPath(new URL("../fixtures/files/csv/", import.meta.url))];
    const report: string[] = [];
    let headers = 0;
    let quoted = 0;
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".csv"))) {
        const line = readFileSync(join(dir, f), "utf8").replace(/^﻿/, "").split(/\r?\n/)[0]!;
        const header = line.split(",");
        headers += header.length;
        quoted += headerRefs(header).columns.filter((c) => c.ref && cellRef(c.ref, 1).startsWith("'")).length;
        report.push(...roundTrip(header).map((b) => `${f}: ${b}`));
      }
    }
    expect(report).toEqual([]);
    expect(headers).toBeGreaterThan(50);
    expect(quoted).toBeGreaterThan(0); // "BTW tarief", "Overzicht Q1 2026", "Table 1"
  });
});
