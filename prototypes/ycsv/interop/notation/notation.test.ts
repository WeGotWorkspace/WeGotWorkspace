import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { CANONICAL, convert, fromLocale, notationFor, readInput, toLocale } from "./notation";

describe("notationFor", () => {
  test.each([
    ["nl-NL", ",", ";"], ["de-DE", ",", ";"], ["fr-FR", ",", ";"], ["en-US", ".", ","], ["en-GB", ".", ","], ["nl-BE", ",", ";"], ["de-CH", ".", ","],
  ])("%s", (loc, dec, sep) => {
    expect(notationFor(loc)).toEqual({ decimal: dec, separator: sep });
  });
});

describe("canonical → nl-NL → canonical", () => {
  const cases: [string, string][] = [
    ["=ROUND(3.27,1)", "=ROUND(3,27;1)"],
    ["=SUM(aantal1,prijs1)", "=SUM(aantal1;prijs1)"],
    ["=IF(a>0.5,\"1,5\",'Zo Doen'2)", "=IF(a>0,5;\"1,5\";'Zo Doen'2)"],
    ["=TEXT(prijs,\"#,##0.00\")", "=TEXT(prijs;\"#,##0.00\")"],
    ["=1.5e3+.5", "=1,5e3+,5"],
    ["=50%*btw", "=50%*btw"],
    ["=VLOOKUP(code,producten!a1:c9,2,FALSE)", "=VLOOKUP(code;producten!a1:c9;2;FALSE)"],
    ["=STDEV.S(x2:x9)", "=STDEV.S(x2:x9)"],
    ["=prijs2*1.21", "=prijs2*1,21"],
  ];
  test.each(cases)("%s ⇄ %s", (canon, nl) => {
    expect(toLocale(canon, "nl-NL")).toBe(nl);
    expect(fromLocale(nl, "nl-NL")).toBe(canon);
  });

  test("property: random canonical formulas survive the round trip", () => {
    const num = fc.oneof(fc.integer({ min: 0, max: 99999 }).map(String), fc.tuple(fc.nat(999), fc.nat(999)).map(([a, b]) => `${a}.${b}`));
    const ref = fc.constantFrom("prijs", "aantal1", "'Zo Doen'2", "x2:x9", "s!a1:b2");
    const str = fc.string({ maxLength: 6 }).map((s) => `"${s.replace(/"/g, '""')}"`);
    const atom = fc.oneof(num, ref, str);
    const call = fc.tuple(fc.constantFrom("SUM", "ROUND", "IF", "MAX"), fc.array(atom, { minLength: 1, maxLength: 4 })).map(([f, a]) => `${f}(${a.join(",")})`);
    const formula = fc.array(fc.oneof(call, atom), { minLength: 1, maxLength: 3 }).map((p) => `=${p.join("+")}`);
    fc.assert(fc.property(formula, (f) => convert(convert(f, CANONICAL, notationFor("nl-NL")), notationFor("nl-NL"), CANONICAL) === f), { seed: 11, numRuns: 2000 });
  });
});

describe("mixed input in nl-NL", () => {
  test("a canonical formula typed in nl-NL is silently read as decimals", () => {
    // The user copied `=ROUND(3.27,1)` from a forum: `.` is not a decimal in nl-NL, so the
    // converter keeps `3.27` as-is (→ #NAME?/parse error) and `,1` would be read as 0.1.
    expect(fromLocale("=SUM(1,2)", "nl-NL")).toBe("=SUM(1.2)");
    expect(readInput("=SUM(1,2)", "nl-NL")).toEqual({ canonical: "=SUM(1.2)", ambiguous: true });
    expect(readInput("=SUM(1;2)", "nl-NL")).toEqual({ canonical: "=SUM(1,2)", ambiguous: false });
    expect(readInput("=SUM(a1,b1)", "nl-NL")).toEqual({ canonical: "=SUM(a1,b1)", ambiguous: false });
  });
});
