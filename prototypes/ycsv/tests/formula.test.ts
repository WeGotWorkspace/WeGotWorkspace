import { expect, test } from "vitest";
import { evalNode, evaluateAll, parseFormula, type RawCells } from "../src/ycsv-formula";

const rowOrder = ["r_a", "r_b"];

function evalFormula(formula: string, extra: RawCells = new Map(), defs: Record<string, unknown> = {}) {
  const raw: RawCells = new Map(extra);
  raw.set("a@r_a", formula);
  return evaluateAll(raw, rowOrder, defs).get("a@r_a");
}

test("evaluates formulas", () => {
  expect(evalFormula("=1+2*3")).toBe(7);
  expect(evalFormula("=(1+2)*3")).toBe(9);
  expect(evalFormula("=2^3^2")).toBe(512);
  expect(evalFormula("=-2^2")).toBe(-4);
  expect(evalFormula("=10/0")).toBe("#DIV/0");
  expect(evalFormula('="a"&"b"')).toBe("#SYNTAX");
  expect(
    evalFormula(
      "=SUM(n@r_a:n@r_b)",
      new Map([
        ["n@r_a", "2"],
        ["n@r_b", "3"],
      ]),
    ),
  ).toBe(5);
  expect(evalFormula('=IF(1>0,"ja","nee")')).toBe("ja");
  expect(evalFormula("=NOPE(1)")).toBe("#NAME");
  expect(evalFormula("=btw", new Map(), { btw: 0.21 })).toBe(0.21);
  expect(evalFormula("=cats.zuivel", new Map(), { cats: { zuivel: "Zuivel" } })).toBe("Zuivel");
});

test("a bare ref reads the current row, and one AST serves every row", () => {
  const raw: RawCells = new Map([
    ["aantal@r_a", "6"],
    ["prijs@r_a", "0.45"],
    ["aantal@r_b", "2"],
    ["prijs@r_b", "2.99"],
    ["totaal@r_a", "=aantal*prijs"],
    ["totaal@r_b", "=aantal*prijs"],
  ]);
  const values = evaluateAll(raw, rowOrder, {});
  expect(values.get("totaal@r_a")).toBeCloseTo(2.7);
  expect(values.get("totaal@r_b")).toBeCloseTo(5.98);

  const ast = parseFormula("aantal*prijs");
  const rowIndex = new Map([
    ["r_a", 0],
    ["r_b", 1],
  ]);
  const shared = {
    def: () => undefined,
    rowIndex,
    rowOrder,
    isColumn: (path: string) => path === "aantal" || path === "prijs",
  };
  const at = (row: string) =>
    evalNode(ast, {
      ...shared,
      currentRow: row,
      cell: (col, id) => Number(raw.get(`${col}@${id}`)),
    });
  expect(at("r_a")).toBeCloseTo(2.7);
  expect(at("r_b")).toBeCloseTo(5.98);
});

test("a bare name prefers a column over a def", () => {
  const raw: RawCells = new Map([
    ["aantal@r_a", "6"],
    ["totaal@r_a", "=aantal"],
  ]);
  expect(evaluateAll(raw, ["r_a"], { aantal: 99 }).get("totaal@r_a")).toBe(6);
});

test("a cross-sheet ref without a row is a syntax error", () => {
  expect(evalFormula("=producten!totaal")).toBe("#SYNTAX");
});

test("marks a cycle and propagates it", () => {
  const raw: RawCells = new Map([
    ["a@r_a", "=b@r_a"],
    ["b@r_a", "=a@r_a"],
    ["c@r_a", "=a@r_a+1"],
  ]);
  const values = evaluateAll(raw, rowOrder, {});
  expect(values.get("a@r_a")).toBe("#CYCLE");
  expect(values.get("b@r_a")).toBe("#CYCLE");
  expect(values.get("c@r_a")).toBe("#CYCLE");
});
