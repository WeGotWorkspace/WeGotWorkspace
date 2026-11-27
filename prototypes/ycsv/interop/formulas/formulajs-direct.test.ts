// Spike 11: call formulajs directly with Excel-shaped arguments (2-D ranges, real errors),
// to tell formulajs gaps apart from engine wiring gaps. Writes formulajs-direct-results.json.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as F from "@formulajs/formulajs";
import { expect, test } from "vitest";

const A = [1, 2, 3, null, 5];
const B = ["a", "B", "c", "a", ""];
const D = [true, false, true, true, false];
const grid2 = [["a", 46027], ["B", 46053], ["c", 46081], ["a", 45351], ["", 46387]];
const fj = F as unknown as Record<string, (...a: unknown[]) => unknown>;
const show = (v: unknown) => (v instanceof Error ? v.message : v instanceof Date ? `Date(${v.toISOString()})` : v);

const CASES: [string, () => unknown, unknown][] = [
  ["SUMIF(B,\"a\",A)", () => fj.SUMIF!(B, "a", A), 1],
  ["SUMIFS(A,B,\"a\",D,TRUE)", () => fj.SUMIFS!(A, B, "a", D, true), 1],
  ["COUNTIFS(B,\"a\",D,TRUE)", () => fj.COUNTIFS!(B, "a", D, true), 2],
  ["MAXIFS(A,D,TRUE)", () => fj.MAXIFS!(A, D, true), 3],
  ["COUNTBLANK(A)", () => fj.COUNTBLANK!(A), 1],
  ["VLOOKUP(\"c\",2-D,2,FALSE)", () => fj.VLOOKUP!("c", grid2, 2, false), 46081],
  ["INDEX(2-D,3,2)", () => fj.INDEX!(grid2, 3, 2), 46081],
  ["IFNA(#N/A,\"na\")", () => fj.IFNA!(F.ERROR ? new Error("#N/A") : fj.NA!(), "na"), "na"],
  ["ISERROR(DIV/0 error)", () => fj.ISERROR!(fj.DIVIDE ? fj.DIVIDE(1, 0) : new Error("#DIV/0!")), true],
  ["TEXT(46027,\"yyyy-mm-dd\")", () => fj.TEXT!(46027, "yyyy-mm-dd"), "2026-01-05"],
  ["DATE(2026,2,30)", () => fj.DATE!(2026, 2, 30), "serial 46083"],
  ["EOMONTH(46027,0)", () => fj.EOMONTH!(46027, 0), "serial 46053"],
  ["SUM with text numbers", () => fj.SUM!(["3", " 4 ", "x", "", "1e3"]), 0],
  ["UPPER(\"straße\")", () => fj.UPPER!("straße"), "STRAẞE (LibreOffice)"],
];

test("formulajs direct", () => {
  const rows = CASES.map(([what, run, excel]) => {
    let got: unknown;
    try { got = show(run()); } catch (e) { got = `throws ${(e as Error).message}`; }
    return { what, formulajs: got, excel };
  });
  writeFileSync(fileURLToPath(new URL("./formulajs-direct-results.json", import.meta.url)), `${JSON.stringify(rows, null, 2)}\n`);
  expect(rows.length).toBe(CASES.length);
});
