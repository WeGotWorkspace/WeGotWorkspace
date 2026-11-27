// Runs the conformance corpus through both implementations and writes
// corpus/*.ycsv, results.json and docs/spike-11-conformance-results.md.
// `pnpm vitest run interop/conformance/run.test.ts`
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { coreImpl, coreShiftedImpl } from "../adapters/core";
import { protoImpl } from "../adapters/proto";
import type { Impl, NormResult } from "../adapters/types";
import { CASES, type Case } from "./cases";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function sameValue(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  // Numbers: equal value AND no more than 15 significant digits shown (Excel's display rule),
  // so 0.30000000000000004 counts as a difference from 0.3.
  const sig = (s: string) => s.replace(/^-/, "").replace(/e.*$/i, "").replace(".", "").replace(/^0+/, "").length;
  if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb))
    return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na)) && sig(a) <= 15 && sig(b) <= 15;
  if (a.toUpperCase() === b.toUpperCase() && /^(true|false)$/i.test(a)) return true;
  // Error spellings differ (#REF vs #REF!), treat "both an error of the same kind" as equal.
  if (a.startsWith("#") && b.startsWith("#")) return a.replace(/[!?]$/, "") === b.replace(/[!?]$/, "");
  return false;
}

function lookup(result: NormResult, key: string): string | undefined {
  if (result.status !== "ok") return undefined;
  const bang = key.indexOf("!");
  const sheet = bang >= 0 ? result.sheets.find((s) => s.ref === key.slice(0, bang)) : result.sheets[0];
  return sheet?.values[bang >= 0 ? key.slice(bang + 1) : key];
}

type Verdict = { pass: boolean; notes: string[] };

function judge(c: Case, r: NormResult): Verdict {
  const notes: string[] = [];
  const e = c.expect;
  if (r.status === "error") {
    if (e.status === "error") return { pass: true, notes: [`error: ${r.error}`] };
    return { pass: false, notes: [`error: ${r.error}`] };
  }
  if (e.status === "error") notes.push("accepted (spec: hard error)");
  if (e.warns && r.warnings.length === 0) notes.push("no warning");
  if (e.sheets !== undefined && r.sheets.length !== e.sheets) notes.push(`${r.sheets.length} sheet(s), expected ${e.sheets}`);
  const s0 = r.sheets[0];
  if (e.refs && s0 && s0.refs.join(",") !== e.refs.join(",")) notes.push(`refs [${s0.refs.join(",")}]`);
  if (e.dataRows !== undefined && s0 && s0.rows.length !== e.dataRows) notes.push(`${s0.rows.length} data rows, expected ${e.dataRows}`);
  for (const [key, want] of Object.entries(e.values ?? {})) {
    const got = lookup(r, key);
    if (!sameValue(got, want)) notes.push(`${key}=${JSON.stringify(got ?? null)} (want ${JSON.stringify(want)})`);
  }
  return { pass: notes.length === 0, notes };
}

function agree(a: NormResult, b: NormResult): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "error" || b.status === "error") return true;
  if (a.sheets.length !== b.sheets.length) return false;
  return a.sheets.every((sa, i) => {
    const sb = b.sheets[i]!;
    if (JSON.stringify(sa.rows) !== JSON.stringify(sb.rows)) return false;
    if (sa.refs.join() !== sb.refs.join()) return false;
    const keys = new Set([...Object.keys(sa.values), ...Object.keys(sb.values)]);
    return [...keys].every((k) => sameValue(sa.values[k], sb.values[k]));
  });
}

function brief(r: NormResult): string {
  if (r.status === "error") return `error: ${r.error}`;
  return r.sheets
    .map((s) => {
      const vals = Object.entries(s.values)
        .filter(([, v]) => v !== "")
        .slice(0, 8)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      return `${s.ref}[${s.refs.join(",")}] ${s.rows.length} rows; ${vals}`;
    })
    .join(" | ") + (r.warnings.length ? ` (warn: ${r.warnings.join("; ")})` : "");
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "\\n");

test("conformance corpus — both implementations", () => {
  mkdirSync(here("./corpus"), { recursive: true });
  const impls: Impl[] = [coreImpl, protoImpl, coreShiftedImpl];
  const rows: string[] = [];
  const details: string[] = [];
  const json: unknown[] = [];
  const tally = { core: 0, proto: 0, shifted: 0, agree: 0, judged: 0 };

  for (const c of CASES) {
    writeFileSync(here(`./corpus/${c.id}.ycsv`), c.text);
    const results = impls.map((impl) => impl.parse(c.text));
    const verdicts = results.map((r) => judge(c, r));
    const same = agree(results[0]!, results[1]!);
    if (c.expect.status !== "silent") {
      tally.judged += 1;
      if (verdicts[0]!.pass) tally.core += 1;
      if (verdicts[1]!.pass) tally.proto += 1;
      if (verdicts[2]!.pass) tally.shifted += 1;
    }
    if (same) tally.agree += 1;
    const mark = (v: Verdict) =>
      c.expect.status === "silent" ? (!c.expect.values ? "see details" : v.notes.length ? `differs from Excel: ${esc(v.notes.join("; "))}` : "matches Excel") : v.pass ? "pass" : `**fail** — ${esc(v.notes.join("; "))}`;
    rows.push(`| \`${c.id}\` | ${esc(c.title)} | ${c.spec} | ${c.expect.status} | ${mark(verdicts[0]!)} | ${mark(verdicts[1]!)} | ${same ? "yes" : "**no**"} | ${mark(verdicts[2]!)} |`);
    details.push(
      `### \`${c.id}\` — ${c.title}\n\n${c.expect.note ? `${c.expect.note}\n\n` : ""}- core: ${esc(brief(results[0]!))}\n- proto: ${esc(brief(results[1]!))}\n- core +1: ${esc(brief(results[2]!))}\n`,
    );
    json.push({ id: c.id, expect: c.expect, core: results[0], proto: results[1], coreShifted: results[2], verdicts, agree: same });
  }

  writeFileSync(here("./results.json"), `${JSON.stringify(json, null, 2)}\n`);
  const md = `# Spike 11 — YCSV conformance results

Generated by \`interop/conformance/run.test.ts\` from \`interop/conformance/cases.ts\`
(${CASES.length} cases; files in \`interop/conformance/corpus/\`). Spec = the unamended
\`upstream/ycsv-spec-v1.md\`. "silent" = the spec does not decide; those rows compare with
what Excel/Sheets/LibreOffice do instead of passing or failing.

- Cases where the spec decides: ${tally.judged}. **core passes ${tally.core}, proto passes ${tally.proto}.** With core's formulas shifted one row (its engine counts the header as row 1), core passes ${tally.shifted}.
- Both implementations give the same result in ${tally.agree} of ${CASES.length} cases.
- core = \`spreadsheet-core\` from \`feat/spreadsheet-core\`; proto = \`prototypes/ycsv\` (single-sheet).

| case | what | spec | spec says | core | proto | agree | core, rows +1 |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Details

${details.join("\n")}`;
  writeFileSync(here("../../docs/spike-11-conformance-results.md"), md);
  expect(CASES.length).toBeGreaterThan(40);
});
