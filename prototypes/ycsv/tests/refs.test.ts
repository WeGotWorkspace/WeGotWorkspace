import { expect, test } from "vitest";
import { toFileForm, toIdForm } from "../src/ycsv-model/refs";

const cols = [
  { colId: "c1", ref: "aantal" },
  { colId: "c2", ref: "prijs" },
];
const rows = ["r_a", "r_b", "r_c"];

test("translates current-row, absolute, and quoted refs", () => {
  expect(toIdForm("=aantal*prijs", cols, rows)).toBe("=aantal*prijs");
  expect(toFileForm("=aantal*prijs", cols, rows)).toBe("=aantal*prijs");
  expect(toIdForm("=aantal1*prijs1", cols, rows)).toBe("=aantal@r_a*prijs@r_a");
  expect(toIdForm("=SUM(aantal1:aantal3)", cols, rows)).toBe("=SUM(aantal@r_a:aantal@r_c)");
  expect(toIdForm("=aantal9", cols, rows)).toBe("=#REF!");
  expect(toFileForm("=aantal@r_b", cols, rows)).toBe("=aantal2");
  expect(toFileForm("=aantal@r_x", cols, rows)).toBe("=#REF!");

  const quoted = [
    { colId: "c1", ref: "Zo Doen" },
    { colId: "c2", ref: "Jan's" },
  ];
  expect(toIdForm("='Zo Doen'2", quoted, rows)).toBe("='Zo Doen'@r_b");
  expect(toFileForm("='Zo Doen'@r_b", quoted, rows)).toBe("='Zo Doen'2");
  expect(toFileForm("='Jan''s'@r_a", quoted, rows)).toBe("='Jan''s'1");

  const plain = [{ colId: "c1", ref: "aantal" }];
  expect(toFileForm("=aantal@r_a", plain, rows)).toBe("=aantal1");

  const ambiguous = [
    { colId: "c1", ref: "q" },
    { colId: "c2", ref: "q1" },
  ];
  expect(toFileForm("=q@r_b", ambiguous, rows)).toBe("='q'2");
  expect(toFileForm("=q1@r_b", ambiguous, rows)).toBe("=q12");
  // 'q'12 is ref q, row 12. rows only has three entries, so the row is out of range.
  expect(toIdForm("='q'12", ambiguous, rows)).toBe("=#REF!");
  expect(toIdForm("='q'2", ambiguous, rows)).toBe("='q'@r_b");
  expect(toIdForm("=q12", ambiguous, rows)).toBe("=q1@r_b");
  // q1 is the column name. Digits in the name are not a row suffix, so this stays current-row.
  expect(toIdForm("=q1", ambiguous, rows)).toBe("=q1");
});

test("uses the longest column ref that leaves a numeric suffix", () => {
  const c2 = [{ colId: "c1", ref: "q1" }];
  expect(toIdForm("=q12", c2, ["r_a", "r_b"])).toBe("=q1@r_b");
});

test("resolves positional letters and writes the canonical ref", () => {
  const headers = [
    { colId: "c1", ref: "product" },
    { colId: "c2", ref: "aantal" },
  ];
  expect(toIdForm("=A1*B1", headers, rows)).toBe("=product@r_a*aantal@r_a");
  expect(toIdForm("=A1*aantal1", headers, rows)).toBe("=product@r_a*aantal@r_a");
  expect(toIdForm("=C1", headers, rows)).toBe("=#REF!");
  expect(toIdForm("=a1", headers, rows)).toBe("=a1");

  const swapped = [
    { colId: "c1", ref: "B" },
    { colId: "c2", ref: "A" },
  ];
  expect(toIdForm("=A1", swapped, rows)).toBe("=A@r_a");

  const explicit = [
    { colId: "c1", ref: "A" },
    { colId: "c2", ref: "product" },
  ];
  expect(toIdForm("=A1", explicit, rows)).toBe("=A@r_a");
  expect(toFileForm(toIdForm("=A1*B1", headers, rows), headers, rows)).toBe("=product1*aantal1");
});
