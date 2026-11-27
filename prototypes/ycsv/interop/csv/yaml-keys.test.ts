// Spike 11: P29 (accepted, changed form) — frontmatter addresses use the formula ref grammar.
// Which address keys survive YAML as plain (unquoted) keys, with the `yaml` package
// (YAML 1.2 core schema, as P25 requires)?
import YAML from "yaml";
import { describe, expect, test } from "vitest";

const parse = (src: string) => {
  const doc = YAML.parseDocument(src, { version: "1.2" });
  return doc.errors.length ? { error: doc.errors[0]!.code } : { value: doc.toJS() as Record<string, unknown> };
};
const key = (k: string) => parse(`cells:\n  ${k}:\n    style:\n      bold: true\n`);
const firstKey = (r: ReturnType<typeof parse>) => ("value" in r ? Object.keys(r.value!.cells as object)[0] : r.error);

describe("address keys in YAML (P29)", () => {
  test.each([
    "product0:totaal0",
    "prijs3",
    "$prijs$3",
    "prijs$1:$totaal$3",
    "totaal:totaal",
    "categorieën1:categorieën3",
    "Größe1",
    "producten!totaal1:totaal5",
    "A0:D0",
  ])("plain key %s reads back unchanged", (k) => {
    expect(firstKey(key(k))).toBe(k);
  });

  test("a quoted ref written bare is invalid YAML (not a silent miss)", () => {
    expect(key("'Prijs incl. BTW'3")).toHaveProperty("error");
    expect(key("'kw1'2:'kw2'4")).toHaveProperty("error");
  });

  test("the whole key double-quoted works", () => {
    expect(firstKey(key(`"'Prijs incl. BTW'3"`))).toBe("'Prijs incl. BTW'3");
    expect(firstKey(key(`"'kw1'2:'kw2'4"`))).toBe("'kw1'2:'kw2'4");
  });

  test("the writer quotes such keys by itself", () => {
    for (const k of ["'Prijs incl. BTW'3", "'kw1'2:'kw2'4"]) {
      const out = YAML.stringify({ cells: { [k]: { bold: true } } });
      expect(out).toContain(`"${k}":`);
      expect(firstKey(parse(out))).toBe(k);
    }
    // Plain refs and ranges stay unquoted.
    expect(YAML.stringify({ cells: { "product0:totaal0": { bold: true } } })).toContain("  product0:totaal0:\n");
  });

  test("YAML-special words as refs: `on`, `yes`, `null` stay strings under 1.2 core", () => {
    // A header named `on` gives the address `on3`; a whole-column key `on` alone is a string in 1.2.
    expect(firstKey(key("on"))).toBe("on");
    expect(firstKey(key("null3"))).toBe("null3");
  });

  test("a key that is only digits and a colon is read as a string, but writers avoid it", () => {
    // `1:2` is not an address in YCSV (rows without a column); a reader must reject it as an address.
    expect(typeof firstKey(key("1:2"))).toBe("string");
  });

  test("flow style is normal YAML: { bold: true }", () => {
    expect(parse("cells:\n  prijs3: { style: { bold: true } }\n")).toEqual({ value: { cells: { prijs3: { style: { bold: true } } } } });
  });
});
