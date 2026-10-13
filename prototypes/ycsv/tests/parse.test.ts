import { expect, test } from "vitest";
import { parse } from "../src/ycsv-core/parse";
import { SEED } from "../src/stories/fixtures";

test("parses the canonical seed", () => {
  const file = parse(SEED);
  expect(file.columns.map((column) => column.ref)).toEqual(["product", "aantal", "prijs", "totaal"]);
  expect(file.rows).toHaveLength(4);
  expect(file.rows[0]?.[3]).toBe("=aantal1*prijs1*(1+btw)");
});

test("rejects a file without frontmatter", () => {
  expect(() => parse("a,b\n1,2\n")).toThrow("YCSV: missing frontmatter");
});

test("rejects a second sheet marker in the body", () => {
  const text = `---
ycsv_version: 1
columns:
  - ref: a
---
a
1
---
a
2
`;
  expect(() => parse(text)).toThrow("YCSV: multi-sheet not supported in prototype");
});

test("fills missing column refs with A–Z fallbacks", () => {
  const text = `---
ycsv_version: 1
columns:
  - type: string
  - type: number
  - type: string
---
A,B,C
1,2,3
`;
  expect(parse(text).columns.map((column) => column.ref)).toEqual(["A", "B", "C"]);
});
