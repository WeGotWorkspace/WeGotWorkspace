import { describe, expect, it } from "vitest";
import { parseTsv, r1c1ToIdForm, tileSize, toTsv } from "../src/ycsv-ux/clipboard";
import { fillSeries } from "../src/ycsv-ux/fill";
import { refText, segments, signatureAt, suggest, wantsRef } from "../src/ycsv-ux/formula-assist";
import { looseNumber } from "../src/ycsv-ux/paste";
import { cycleWithin, dataEdge, extend, single } from "../src/ycsv-ux/selection";
import { dropColumnRefs, shiftFormula } from "../src/ycsv-ux/shift";
import { toFileForm, toIdForm } from "../src/ycsv-model/refs";
import { evaluateAll } from "../src/ycsv-formula";

const cols = [
  { colId: "c_a", ref: "a" },
  { colId: "c_b", ref: "b" },
  { colId: "c_c", ref: "c" },
];
const rowIds = ["r1", "r2", "r3", "r4"];
const rowIndex = new Map(rowIds.map((id, i) => [id, i]));
const ctx = { colRefs: ["a", "b", "c"], rowIds, rowIndex };

describe("$ absolute marks round-trip through id form", () => {
  it("file → id → file", () => {
    const id = toIdForm("=$a$1+a2+$b3+c$4", cols, rowIds);
    expect(id).toBe("=$a@$r1+a@r2+$b@r3+c@$r4");
    expect(toFileForm(id, cols, rowIds)).toBe("=$a$1+a2+$b3+c$4");
  });
  it("evaluation ignores the marks", () => {
    const raw = new Map([
      ["a@r1", "2"],
      ["b@r1", "=$a@$r1*3"],
    ]);
    expect(evaluateAll(raw, ["r1"], {}, ["a", "b"]).get("b@r1")).toBe(6);
  });
  it("rectangular ranges sum every column between the ends", () => {
    const raw = new Map([
      ["a@r1", "1"],
      ["b@r1", "2"],
      ["a@r2", "3"],
      ["b@r2", "4"],
      ["c@r1", "=SUM(a@r1:b@r2)"],
    ]);
    expect(evaluateAll(raw, ["r1", "r2"], {}, ["a", "b", "c"]).get("c@r1")).toBe(10);
  });
});

describe("shiftFormula", () => {
  it("moves relative rows and columns, keeps $ and same-row names", () => {
    expect(shiftFormula("=a@r1*2+$a@$r1+b", 2, 0, ctx)).toBe("=a@r3*2+$a@$r1+b");
    expect(shiftFormula("=a@r1+b", 0, 1, ctx)).toBe("=b@r1+c");
  });
  it("off the edge becomes #REF!", () => {
    expect(shiftFormula("=a@r4", 1, 0, ctx)).toBe("=#REF!");
    expect(shiftFormula("=c@r1", 0, 1, ctx)).toBe("=#REF!");
  });
  it("leaves function names and defs alone", () => {
    expect(shiftFormula("=SUM(a@r1:a@r2)*btw", 1, 0, ctx)).toBe("=SUM(a@r2:a@r3)*btw");
  });
  it("dropColumnRefs", () => {
    expect(dropColumnRefs("=a*b@r1+c", "b")).toBe("=a*#REF!+c");
  });
});

describe("fillSeries", () => {
  const noShift = (f: string) => f;
  it("linear numbers, both directions", () => {
    expect(fillSeries(["1", "3"], [2, 3], noShift)).toEqual(["5", "7"]);
    expect(fillSeries(["1", "3"], [-1, -2], noShift)).toEqual(["-1", "-3"]);
    expect(fillSeries(["0.1", "0.2"], [2], noShift)).toEqual(["0.3"]);
  });
  it("a single number copies unless increment", () => {
    expect(fillSeries(["5"], [1, 2], noShift)).toEqual(["5", "5"]);
    expect(fillSeries(["5"], [1, 2], noShift, { increment: true })).toEqual(["6", "7"]);
  });
  it("dates by day and by month, clamping month ends", () => {
    expect(fillSeries(["2026-01-31"], [1], noShift)).toEqual(["2026-02-01"]);
    // Different days of the month: a day step (28), not a month step. Excel would see month ends.
    expect(fillSeries(["2026-01-31", "2026-02-28"], [2], noShift)).toEqual(["2026-03-28"]);
    expect(fillSeries(["2026-01-15", "2026-02-15"], [2, 3], noShift)).toEqual(["2026-03-15", "2026-04-15"]);
  });
  it("text with a number keeps padding; lists keep case", () => {
    expect(fillSeries(["Item 09"], [1, 2], noShift)).toEqual(["Item 10", "Item 11"]);
    expect(fillSeries(["Q3"], [1, 2], noShift)).toEqual(["Q4", "Q1"]);
    expect(fillSeries(["jan", "mar"], [2], noShift)).toEqual(["may"]);
  });
  it("mixed values repeat; formulas shift by their distance", () => {
    expect(fillSeries(["x", "=a@r1"], [2, 3], (f, s) => `${f}+${s}`)).toEqual(["x", "=a@r1+2"]);
  });
});

describe("selection", () => {
  const bounds = { rows: 10, cols: 4 };
  const filled = new Set(["0,0", "1,0", "2,0", "6,0"]);
  const isEmpty = (r: number, c: number) => !filled.has(`${r},${c}`);
  it("data edge: end of block, next block, sheet edge", () => {
    expect(dataEdge({ r: 0, c: 0 }, "down", bounds, isEmpty)).toEqual({ r: 2, c: 0 });
    expect(dataEdge({ r: 2, c: 0 }, "down", bounds, isEmpty)).toEqual({ r: 6, c: 0 });
    expect(dataEdge({ r: 6, c: 0 }, "down", bounds, isEmpty)).toEqual({ r: 9, c: 0 });
  });
  it("extend keeps the anchor; Enter cycles column-wise inside a range", () => {
    let s = single({ r: 1, c: 1 });
    s = extend(s, "down", bounds);
    s = extend(s, "right", bounds);
    expect(s.ranges[0]).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
    s = cycleWithin(s, "down", bounds);
    expect(s.active).toEqual({ r: 2, c: 1 });
    s = cycleWithin(s, "down", bounds);
    expect(s.active).toEqual({ r: 1, c: 2 });
  });
});

describe("clipboard", () => {
  it("TSV round-trip with tabs, quotes and newlines", () => {
    const grid = [["a\tb", 'say "hi"'], ["line\nbreak", ""]];
    expect(parseTsv(toTsv(grid))).toEqual(grid);
  });
  it("R1C1 → id form relative to the paste target", () => {
    const refAt = (r: number, c: number, ar: boolean, ac: boolean) => `${ac ? "$" : ""}${"abc"[c]}@${ar ? "$" : ""}${rowIds[r]}`;
    expect(r1c1ToIdForm("=R[0]C[-1]*2+R1C1", { r: 2, c: 1 }, refAt)).toBe("=a@r3*2+$a@$r1");
  });
  it("tiling only on exact multiples", () => {
    expect(tileSize(2, 1, 6, 2)).toEqual({ rows: 6, cols: 2 });
    expect(tileSize(2, 1, 5, 1)).toEqual({ rows: 2, cols: 1 });
  });
  it("looseNumber by locale", () => {
    expect(looseNumber("€ 1.234,50", true)).toBe("1234.5");
    expect(looseNumber("1,234.50", false)).toBe("1234.5");
    expect(looseNumber("3,5", false)).toBe("3.5");
    expect(looseNumber("1,234", false)).toBe("1234");
    expect(looseNumber("1,234", true)).toBe("1.234");
    expect(looseNumber("1.234", true)).toBe("1234");
    expect(looseNumber("50%", true)).toBe("50%");
    expect(looseNumber("abc", true)).toBe("abc");
  });
});

describe("formula assist", () => {
  const resolve = (ident: string) => {
    const m = /^\$?([a-c])\$?(\d+)$/.exec(ident);
    if (m) return { r: Number(m[2]) - 1, c: "abc".indexOf(m[1] ?? "") };
    if (/^[a-c]$/.test(ident)) return { r: 0, c: "abc".indexOf(ident) };
    return null;
  };
  it("colours refs consistently and merges ranges", () => {
    const segs = segments("=a1+SUM(b1:b3)+$a$1", resolve);
    const refs = segs.filter((s) => s.kind === "ref");
    expect(refs.map((s) => s.text)).toEqual(["a1", "b1:b3", "$a$1"]);
    expect(refs.map((s) => (s.kind === "ref" ? s.color : -1))).toEqual([0, 1, 0]);
  });
  it("wantsRef after operators and right after a pick", () => {
    expect(wantsRef("=", 1, 0)).toBe(true);
    expect(wantsRef("=SUM(", 5, 0)).toBe(true);
    expect(wantsRef("=a1", 3, 0)).toBe(false);
    expect(wantsRef("=a1", 3, 2)).toBe(true);
    expect(wantsRef("abc", 3, 0)).toBe(false);
  });
  it("refText uses the bare column for the edited row", () => {
    const colRef = (c: number) => "abc"[c] ?? "";
    expect(refText({ r1: 2, c1: 1, r2: 2, c2: 1 }, 2, colRef)).toBe("b");
    expect(refText({ r1: 0, c1: 1, r2: 0, c2: 1 }, 2, colRef)).toBe("b1");
    expect(refText({ r1: 0, c1: 0, r2: 3, c2: 1 }, 2, colRef)).toBe("a1:b4");
  });
  it("suggests columns, defs and functions; signature tracks the argument", () => {
    const s = suggest("=su", 3, [{ ref: "sub", name: "Subtotal" }], { suffix: 1 });
    expect(s?.items.map((i) => i.label).slice(0, 3)).toEqual(["sub", "suffix", "SUM"]);
    expect(suggest('="su', 4, [], {})).toBeNull();
    expect(signatureAt("=IF(a1>2, ", 10)?.arg).toBe(1);
    expect(signatureAt("=ROUND(SUM(1,2), ", 17)?.sig.name).toBe("ROUND");
  });
});
