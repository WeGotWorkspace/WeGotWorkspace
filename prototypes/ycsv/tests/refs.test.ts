import { expect, test } from "vitest";
import { toFileForm, toIdForm } from "../src/ycsv-model/refs";

const cols = [
  { colId: "c1", ref: "aantal" },
  { colId: "c2", ref: "prijs" },
];
const rows = ["r_a", "r_b", "r_c"];

test("translates file-form refs to id-form and back", () => {
  expect(toIdForm("=aantal1*prijs1", cols, rows)).toBe("=aantal@r_a*prijs@r_a");
  expect(toIdForm("=SUM(aantal1:aantal3)", cols, rows)).toBe("=SUM(aantal@r_a:aantal@r_c)");
  expect(toIdForm("=aantal9", cols, rows)).toBe("=#REF!");
  expect(toIdForm("=prijs1*(1+btw)", cols, rows)).toBe("=prijs@r_a*(1+btw)");
  expect(toIdForm('=IF(aantal1>0,"ja","nee")', cols, rows)).toBe('=IF(aantal@r_a>0,"ja","nee")');
  expect(toFileForm("=aantal@r_b", cols, rows)).toBe("=aantal2");
  expect(toFileForm("=aantal@r_x", cols, rows)).toBe("=#REF!");
});

test("uses the longest column ref that leaves a numeric suffix", () => {
  const c2 = [{ colId: "c1", ref: "q1" }];
  expect(toIdForm("=q12", c2, ["r_a", "r_b"])).toBe("=q1@r_b");
});
