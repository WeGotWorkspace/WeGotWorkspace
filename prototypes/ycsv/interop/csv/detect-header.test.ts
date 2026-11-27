import { describe, expect, test } from "vitest";
import { detectHeader } from "./detect-header";

const csv = (s: string) => s.trim().split("\n").map((l) => l.split(","));

describe("detectHeader (spec §4.1 with P2/P27)", () => {
  test.each<[string, string, boolean, string]>([
    ["typical table", "product,aantal,prijs\nAppels,6,0.45\nBrood,2,2.99", true, "D6"],
    ["spec 9.1: no header, A-Z", "Appels,6,0.45,=A1*B1*C1\nBrood,2,2.99,=A2*B2*C2", false, "D4"],
    ["year in row 1", "Totaal,2026,2027\nOmzet,100,120\nKosten,80,90", false, "D4"],
    ["date in row 1", "2026-01-05,Huur,1250\n2026-02-01,Stroom,89", false, "D4"],
    ["empty header cell", "product,,prijs\nAppels,x,0.45\nBrood,y,2.99", false, "D4"],
    ["duplicate header", "naam,naam\nJan,Piet\nKees,Mies", false, "D5"],
    ["single row", "product,prijs", false, "D3"],
    ["formula in row 1", "=1+1,b\n1,2\n3,4", false, "D4"],
    ["all text, contact list", "Naam,Plaats\nJan,Utrecht\nPiet,Gouda", true, "D7"],
    ["all text, row-1 value repeats", "Utrecht,Jan\nGouda,Piet\nUtrecht,Kees", false, "D7"],
    ["empty first line", ",,\nAppels,6,0.45\nBrood,2,2.99", false, "D1"],
    ["header above empty row and data", "a,b\n,\n1,2\n3,4", true, "D6"],
  ])("%s", (_, src, header, rule) => {
    const d = detectHeader(csv(src));
    expect(d.header).toBe(header);
    expect(d.rule.slice(0, 2)).toBe(rule);
  });

  test("with columns: row 1 must match refs or names", () => {
    const columns = [{ ref: "product" }, { ref: "prijs", name: "Prijs ex. BTW" }];
    expect(detectHeader(csv("Product,Prijs ex. BTW\nAppels,0.45"), columns).header).toBe(true);
    expect(detectHeader(csv("prijs,product\nAppels,0.45"), columns).header).toBe(true);
    expect(detectHeader(csv("Appels,0.45\nBrood,2.99"), columns).header).toBe(false);
  });
});
