import { describe, expect, test } from "vitest";
import { resolveColumns } from "./resolve-columns";

const refs = (r: ReturnType<typeof resolveColumns>) => r.columns.map((c) => `${c.ref}:${c.def?.type ?? "-"}:${c.how}`);

describe("columns as enrichment of a CSV header (C1–C5)", () => {
  const defs = [{ ref: "product", type: "string" }, { ref: "prijs", type: "currency" }, { ref: "aantal", type: "number" }];

  test("hand-typed: header texts equal the refs", () => {
    expect(refs(resolveColumns(["product", "prijs", "aantal"], 3, defs))).toEqual(["product:string:name", "prijs:currency:name", "aantal:number:name"]);
  });

  test("outside writer reorders columns: name match follows the column", () => {
    const r = resolveColumns(["aantal", "product", "prijs"], 3, defs);
    expect(refs(r)).toEqual(["aantal:number:name", "product:string:name", "prijs:currency:name"]);
    expect(r.warnings).toEqual([]);
  });

  test("display-name headers (Prijs ex. BTW): position, with a warning", () => {
    const r = resolveColumns(["Product", "Prijs ex. BTW", "Aantal"], 3, defs);
    expect(refs(r)).toEqual(["product:string:name", "prijs:currency:position", "aantal:number:name"]);
    expect(r.columns[1]!.display).toBe("Prijs ex. BTW");
    expect(r.warnings).toHaveLength(1);
  });

  test("risk: display-name headers reordered by an outside writer attach by position", () => {
    // Both columns have display names that are not their refs → positional → swapped types.
    const d = [{ ref: "netto", type: "currency" }, { ref: "omschrijving", type: "string" }];
    const r = resolveColumns(["Omschrijving van de post", "Bedrag netto"], 2, d);
    expect(refs(r)).toEqual(["netto:currency:position", "omschrijving:string:position"]);
    expect(r.warnings).toHaveLength(2); // the reader can see it, it is not silent
  });

  test("user renames a header in a CSV tool: falls back to position, same column", () => {
    expect(refs(resolveColumns(["product", "stukprijs", "aantal"], 3, defs))).toEqual(["product:string:name", "prijs:currency:position", "aantal:number:name"]);
  });

  test("extra CSV column (outside writer appended one)", () => {
    expect(refs(resolveColumns(["product", "prijs", "aantal", "Opmerking"], 4, defs))).toEqual(["product:string:name", "prijs:currency:name", "aantal:number:name", "Opmerking:-:none"]);
  });

  test("CSV column removed: the definition is unused, warned", () => {
    const r = resolveColumns(["product", "aantal"], 2, defs);
    expect(refs(r)).toEqual(["product:string:name", "aantal:number:name"]);
    expect(r.warnings.some((w) => w.includes("prijs has no CSV column"))).toBe(true);
  });

  test("columns.name differing from the header: header is the display name, warned", () => {
    const r = resolveColumns(["product"], 1, [{ ref: "product", name: "Artikel" }]);
    expect(r.columns[0]!.display).toBe("product");
    expect(r.warnings[0]).toContain("differs");
  });

  test("K13: display-name headers match by name, also when reordered (spec example 9.3)", () => {
    const d = [{ ref: "product" }, { ref: "aantal" }, { ref: "prijs", name: "Prijs ex. BTW" }, { ref: "totaal", name: "Prijs incl. BTW" }];
    const r = resolveColumns(["product", "aantal", "Prijs ex. BTW", "Prijs incl. BTW"], 4, d);
    expect(refs(r)).toEqual(["product:-:name", "aantal:-:name", "prijs:-:name", "totaal:-:name"]);
    expect(r.warnings).toEqual([]);
    const swapped = resolveColumns(["Prijs incl. BTW", "product", "aantal", "Prijs ex. BTW"], 4, d);
    expect(refs(swapped)).toEqual(["totaal:-:name", "product:-:name", "aantal:-:name", "prijs:-:name"]);
  });

  test("no header: position, name is the display name", () => {
    const r = resolveColumns(null, 3, [{ ref: "product", name: "Artikel" }]);
    expect(r.columns.map((c) => `${c.ref}/${c.display}`)).toEqual(["product/Artikel", "B/B", "C/C"]);
  });
});
