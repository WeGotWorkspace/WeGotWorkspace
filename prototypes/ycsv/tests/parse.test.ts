import { expect, test } from "vitest";
import * as Y from "yjs";
import { headerLooksNumeric, parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import { docToFile, fileToDoc } from "../src/ycsv-model";
import { SEED } from "../src/stories/fixtures";

test("parses the canonical seed", () => {
  const file = parse(SEED);
  expect(file.columns.map((column) => column.ref)).toEqual(["product", "aantal", "prijs", "totaal"]);
  expect(file.rows).toHaveLength(4);
  expect(file.rows[0]?.[3]).toBe("=aantal*prijs*(1+btw)");
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

test("fills missing column refs from the header", () => {
  const text = `---
ycsv_version: 1
columns:
  - type: string
  - type: number
---
Naam,Aantal
Appels,6
`;
  expect(parse(text).columns.map((column) => column.ref)).toEqual(["Naam", "Aantal"]);
});

test("keeps a header-only file free of a columns block", () => {
  const text = `---
ycsv_version: 1
name: Plain
---
product,aantal
Appels,6
`;
  const file = parse(text);
  expect(file.columns.map((column) => column.ref)).toEqual(["product", "aantal"]);
  expect(file.frontmatter.columns).toBeUndefined();
  expect(serialize(file)).toBe(text);
});

test("an explicit ref wins over the header", () => {
  const text = `---
ycsv_version: 1
columns:
  - ref: sku
    type: string
---
product
Appels
`;
  expect(parse(text).columns[0]?.ref).toBe("sku");
});

test("an empty header leaves the column without a ref", () => {
  const text = `---
ycsv_version: 1
columns:
  - ref: product
    type: string
  - type: number
---
product,
Appels,6
`;
  const columns = parse(text).columns;
  expect(columns[0]?.ref).toBe("product");
  expect(columns[1]?.ref).toBeUndefined();
});

test("duplicate refs are an error", () => {
  const text = `---
ycsv_version: 1
---
product,product
1,2
`;
  expect(() => parse(text)).toThrow('YCSV: duplicate column ref "product"');
});

test("a headerless body is still parsed as a header plus one fewer data row", () => {
  const text = `---
ycsv_version: 1
---
Appels,6,0.45
Brood,2,2.99
`;
  const file = parse(text);
  expect(file.columns.map((column) => column.ref)).toEqual(["Appels", "6", "0.45"]);
  expect(file.rows).toEqual([["Brood", "2", "2.99"]]);
  expect(headerLooksNumeric("6")).toBe(true);
  expect(headerLooksNumeric("0.45")).toBe(true);
  expect(headerLooksNumeric("Appels")).toBe(false);
});

test("a header with spaces and a euro sign is quoted when a formula names it", () => {
  const text = `---
ycsv_version: 1
---
"Prijs €",aantal
1,=A1
`;
  const file = parse(text);
  expect(file.columns[0]?.ref).toBe("Prijs €");
  const doc = new Y.Doc();
  fileToDoc(file, doc);
  expect(serialize(docToFile(doc))).toContain("='Prijs €'1");
});
