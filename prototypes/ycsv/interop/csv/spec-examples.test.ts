// Spike 11: the examples in upstream/ycsv-spec-v1-clean.md parse, and their column refs resolve
// as the text says (header refs §4.4, `columns` matching §4.3, addresses §3.6).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { describe, expect, test } from "vitest";
import { detectHeader } from "./detect-header";
import { headerRefs } from "./header-refs";
import { resolveColumns } from "./resolve-columns";

const spec = readFileSync(fileURLToPath(new URL("../../upstream/ycsv-spec-v1-clean.md", import.meta.url)), "utf8");
const section = (h: string) => spec.slice(spec.indexOf(h), spec.indexOf("\n### ", spec.indexOf(h) + 4));
const blocks = (s: string) => [...s.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1]!, text: m[2]! }));
const csv = (s: string) => s.trim().split("\n").map((l) => l.split(","));

describe("spec examples", () => {
  test("every yaml block parses as YAML 1.2", () => {
    const ys = blocks(spec).filter((b) => b.lang === "yaml");
    expect(ys.length).toBeGreaterThan(10);
    for (const b of ys) expect(YAML.parseDocument(b.text.replace(/^---\n/, "").replace(/\n---\n[\s\S]*$/, "\n"), { version: "1.2" }).errors, b.text.slice(0, 60)).toEqual([]);
  });

  test("9.1: no header, letters", () => {
    expect(detectHeader(csv(blocks(section("### 9.1"))[0]!.text)).header).toBe(false);
  });

  test("9.2: header names are the refs", () => {
    const rows = csv(blocks(section("### 9.2"))[0]!.text);
    expect(detectHeader(rows).header).toBe(true);
    expect(headerRefs(rows[0]!).columns.map((c) => c.ref)).toEqual(["product", "aantal", "prijs", "totaal"]);
  });

  test("9.3: frontmatter parses, columns attach by name without warnings, header address resolves", () => {
    const text = blocks(section("### 9.3"))[0]!.text;
    const [, fmText, body] = text.split(/^---$/m);
    const fm = YAML.parse(fmText!, { version: "1.2" });
    const rows = csv(body!);
    const r = resolveColumns(rows[0]!, 4, fm.columns);
    expect(r.columns.map((c) => c.ref)).toEqual(["product", "aantal", "prijs", "totaal"]);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(fm.cells)).toEqual(["product0:totaal0"]);
  });

  test("9.5: quoted refs and the double-quoted YAML key", () => {
    const [csvBlock, yamlBlock] = blocks(section("### 9.5"));
    const rows = csv(csvBlock!.text);
    expect(detectHeader(rows).header).toBe(true);
    expect(headerRefs(rows[0]!).columns.map((c) => c.ref)).toEqual(["Omschrijving", "Prijs incl. BTW", "kw1", "kw2"]);
    expect(Object.keys(YAML.parse(yamlBlock!.text).cells)).toEqual(["'Prijs incl. BTW'3"]);
  });
});
