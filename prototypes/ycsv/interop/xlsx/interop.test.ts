// Spike 11 import/export run. `pnpm vitest run interop/xlsx/interop.test.ts`
// Needs the fixtures (`node interop/fixtures/gen-fixtures.ts`) and LibreOffice (`soffice`).
// Writes interop/fixtures/out/* and interop/xlsx/results.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import YAML from "yaml";
import { expect, test } from "vitest";
import { evaluateImportFull } from "./evaluate";
import { readAmended, toCsv, toExcelJS, toSheetJS } from "./export";
import { importWorkbook, serialToIso, type LogEntry } from "./import";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FILES = here("../fixtures/files/");
const OUT = here("../fixtures/out/");

function soffice(args: string[]): void {
  const profile = mkdtempSync(join(tmpdir(), "lo-profile-"));
  try {
    execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", ...args], { stdio: "pipe", timeout: 120_000 });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** LibreOffice opens `file`, recalculates, writes one CSV per sheet; returns sheet → rows. */
function libreCsv(file: string): Record<string, string[][]> {
  const dir = mkdtempSync(join(tmpdir(), "lo-csv-"));
  try {
    soffice(["--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir", dir, file]);
    const out: Record<string, string[][]> = {};
    const base = file.split("/").pop()!.replace(/\.[^.]+$/, "");
    for (const f of readdirSync(dir)) {
      const sheet = f.replace(`${base}-`, "").replace(/\.csv$/, "");
      out[sheet] = XLSX.utils.sheet_to_json<string[]>(XLSX.read(readFileSync(join(dir, f), "utf8"), { type: "string", raw: true }).Sheets.Sheet1!, { header: 1, raw: false, defval: "" });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compareCsv(a: Record<string, string[][]>, b: Record<string, string[][]>) {
  let cells = 0, same = 0;
  const diffs: string[] = [];
  for (const [sheet, rows] of Object.entries(a)) {
    const other = b[sheet];
    if (!other) {
      diffs.push(`sheet ${sheet} missing`);
      continue;
    }
    rows.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v === "") return;
        cells += 1;
        const w = other[r]?.[c] ?? "";
        if (v === w) same += 1;
        else diffs.push(`${sheet}!${XLSX.utils.encode_cell({ r, c })}: ${JSON.stringify(v)} → ${JSON.stringify(w)}`);
      }),
    );
  }
  return { cells, same, diffs };
}

function probe(path: string) {
  const wb = XLSX.read(readFileSync(path), { cellFormula: true, cellNF: true, sheetStubs: true });
  let formulas = 0, fmts = 0, notes = 0;
  for (const n of wb.SheetNames)
    for (const [k, c] of Object.entries(wb.Sheets[n]!)) {
      if (k.startsWith("!")) continue;
      const cell = c as XLSX.CellObject;
      if (cell.f) formulas += 1;
      if (cell.z && cell.z !== "General") fmts += 1;
      if (cell.c?.length) notes += 1;
    }
  return {
    sheets: wb.SheetNames.join(" | "),
    hidden: (wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name).join(","),
    names: (wb.Workbook?.Names ?? []).filter((n) => !n.Name.startsWith("_xlnm")).map((n) => `${n.Name}=${n.Ref}`).join("; "),
    formulas, formattedCells: fmts, notes,
    merges: wb.SheetNames.reduce((n, s) => n + (wb.Sheets[s]!["!merges"]?.length ?? 0), 0),
  };
}

const lineDiff = (a: string, b: string) => {
  const A = a.split("\n"), B = new Set(b.split("\n"));
  return A.filter((l) => !B.has(l));
};

test("xlsx / ods import, evaluation and export", async () => {
  mkdirSync(OUT, { recursive: true });
  const fixtures = [
    "studio.exceljs.xlsx", "studio.libreoffice.xlsx", "studio.libreoffice.ods", "google-shape.xlsx",
    // Apple Numbers (made with Numbers 15.1 via osascript; see docs/spike-11-interop.md)
    "numbers/native-full.numbers", "numbers/native-full.xlsx", "numbers/studio.from-xlsx.numbers", "numbers/studio.from-xlsx.numbers.xlsx",
  ];
  const results: Record<string, unknown> = {};
  // LibreOffice's own values for the studio workbook: the reference every export is held to.
  const reference = libreCsv(join(FILES, "studio.libreoffice.ods"));

  for (const fx of fixtures) {
    const imp = importWorkbook(readFileSync(join(FILES, fx)), { source: fx });
    const base = fx.replace(/[./]/g, "_");
    writeFileSync(join(OUT, `${base}.ycsv`), imp.text);
    const fm = YAML.parse(imp.text.slice(4, imp.text.indexOf("\n---\n", 4)));
    const defs = new Map<string, string>(Object.entries(fm.defs ?? {}));
    fm.sheets.forEach((s: { defs?: Record<string, string> }) => Object.entries(s.defs ?? {}).forEach(([k, v]) => defs.set(k, v)));
    const { checks, values } = evaluateImportFull(imp, defs);
    // No silent wrong values: every formula whose result differs from the producing app's
    // cached value is reported (fallback: keep the formula, flag the cell, show both values).
    for (const c of checks)
      if (c.cached !== undefined && !c.match)
        imp.log.push({ feature: "formula result differs from source app", outcome: "degrades", detail: `${c.where} ${c.ycsv}: source ${JSON.stringify(c.cached)}, engine ${JSON.stringify(c.engine)}` });

    // Our reader must read back exactly what the importer wrote.
    const parsed = readAmended(imp.text);
    const readBackOk = JSON.stringify(parsed.bodies) === JSON.stringify(imp.grids);

    // Export: SheetJS (xlsx, ods), exceljs (xlsx), CSV per sheet from engine values.
    const sjs = toSheetJS(parsed, values);
    const paths = { sheetjsXlsx: join(OUT, `${base}.sheetjs.xlsx`), sheetjsOds: join(OUT, `${base}.sheetjs.ods`), exceljsXlsx: join(OUT, `${base}.exceljs.xlsx`) };
    writeFileSync(paths.sheetjsXlsx, XLSX.write(sjs, { bookType: "xlsx", type: "buffer" }));
    writeFileSync(paths.sheetjsOds, XLSX.write(sjs, { bookType: "ods", type: "buffer" }));
    writeFileSync(paths.exceljsXlsx, await toExcelJS(parsed));
    parsed.fm.sheets.forEach((s, si) => {
      const rows = (parsed.bodies[si] ?? []).map((row, r) =>
        row.map((v, c) => {
          if (!v.startsWith("=")) return v.startsWith("'") ? v.slice(1) : v;
          const val = values[si]?.[r]?.[c];
          const addr = XLSX.utils.encode_cell({ r, c });
          const type = String(s.cells?.[addr]?.type ?? s.columns?.[c]?.type ?? "");
          if (typeof val === "number" && ["date", "time", "datetime"].includes(type)) return serialToIso(val, type);
          if (typeof val === "boolean") return val ? "true" : "false";
          return val === null || val === undefined ? "" : String(val);
        }),
      );
      writeFileSync(join(OUT, `${base}.${s.ref}.csv`), toCsv(rows));
    });

    // Re-import each export and diff the YCSV text with the first import.
    const reimport: Record<string, { lostLines: string[]; probe: unknown }> = {};
    for (const [k, path] of Object.entries(paths)) {
      const again = importWorkbook(readFileSync(path), { source: path });
      reimport[k] = { lostLines: lineDiff(imp.text, again.text), probe: probe(path) };
    }

    // LibreOffice recalculates every export; compare with LibreOffice's values of the original.
    const libre: Record<string, unknown> = {};
    if (fx.startsWith("studio")) {
      for (const [k, path] of Object.entries(paths)) {
        const cmp = compareCsv(reference, libreCsv(path));
        libre[k] = { cells: cmp.cells, same: cmp.same, diffs: cmp.diffs };
      }
    }

    const tally = (o: LogEntry["outcome"]) => imp.log.filter((l) => l.outcome === o).length;
    results[fx] = {
      log: imp.log,
      tally: { survives: tally("survives"), degrades: tally("degrades"), lost: tally("lost") },
      formulas: {
        total: checks.length,
        textRoundTrip: checks.filter((c) => c.roundTripText).length,
        withCachedValue: checks.filter((c) => c.cached !== undefined).length,
        engineMatchesCached: checks.filter((c) => c.match).length,
        mismatches: checks.filter((c) => c.cached !== undefined && !c.match).map((c) => ({ where: c.where, ycsv: c.ycsv, cached: c.cached, engine: c.engine })),
        notRoundTripped: checks.filter((c) => !c.roundTripText).map((c) => ({ where: c.where, original: c.a1Original, back: c.a1Back })),
      },
      readBackOk,
      reimport,
      libre,
    };
  }
  writeFileSync(here("./results.json"), `${JSON.stringify(results, null, 2)}\n`);
  expect(Object.keys(results)).toHaveLength(fixtures.length);
}, 600_000);
