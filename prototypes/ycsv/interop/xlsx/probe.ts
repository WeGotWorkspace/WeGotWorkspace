// Which workbook features does each library expose? Writes interop/xlsx/probe-results.json.
//   node interop/xlsx/probe.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

const files = fileURLToPath(new URL("../fixtures/files/", import.meta.url));
type Probe = Record<string, string | number | boolean>;

function probeSheetJS(path: string): Probe {
  const wb = XLSX.read(readFileSync(path), { cellFormula: true, cellNF: true, cellStyles: true, cellDates: false, bookVBA: false, cellHTML: false });
  const out: Probe = { sheets: wb.SheetNames.join(" | ") };
  const hidden = (wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name);
  out.hiddenSheets = hidden.join(",") || "none seen";
  out.definedNames = (wb.Workbook?.Names ?? []).map((n) => `${n.Name}${n.Sheet !== undefined ? `@${n.Sheet}` : ""}=${n.Ref}`).join("; ") || "none";
  let formulas = 0, cached = 0, fmts = new Set<string>(), comments = 0, links = 0, bold = 0, fills = 0, merges = 0, cols = 0, hiddenCols = 0, rowsH = 0, dv = 0, cf = 0, xlfn = 0, dummy = 0;
  const freeze: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]!;
    merges += (ws["!merges"] ?? []).length;
    cols += (ws["!cols"] ?? []).filter((c) => c && (c.wch || c.wpx || c.width)).length;
    hiddenCols += (ws["!cols"] ?? []).filter((c) => c?.hidden).length;
    rowsH += (ws["!rows"] ?? []).filter((r) => r && (r.hpt || r.hpx)).length;
    // SheetJS CE has no documented freeze / data validation / conditional formatting API.
    const anyWs = ws as Record<string, unknown>;
    if (anyWs["!freeze"] || anyWs["!pane"] || anyWs["!views"]) freeze.push(name);
    if (anyWs["!dataValidation"] || anyWs["!validations"]) dv += 1;
    if (anyWs["!condfmt"]) cf += 1;
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr.startsWith("!")) continue;
      const c = cell as XLSX.CellObject & { s?: { font?: { bold?: boolean }; fgColor?: unknown; patternType?: string } };
      if (c.f) {
        formulas += 1;
        if (c.v !== undefined) cached += 1;
        if (c.f.includes("_xlfn.")) xlfn += 1;
        if (c.f.includes("__xludf.DUMMYFUNCTION")) dummy += 1;
      }
      if (c.z && c.z !== "General") fmts.add(String(c.z));
      if (c.c?.length) comments += 1;
      if (c.l) links += 1;
      if (c.s?.font?.bold) bold += 1;
      if (c.s?.fgColor || (c.s?.patternType && c.s.patternType !== "none")) fills += 1;
    }
  }
  Object.assign(out, {
    formulas, cachedValues: cached, xlfnPrefixed: xlfn, googleDummyFunctions: dummy,
    numberFormats: [...fmts].join(" ‖ "), comments, hyperlinks: links,
    merges, colWidths: cols, hiddenCols, rowHeights: rowsH,
    freeze: freeze.join(",") || "not exposed",
    dataValidation: dv || "not exposed", conditionalFormatting: cf || "not exposed",
    boldCells: bold, fillCells: fills,
  });
  return out;
}

async function probeExcelJS(path: string): Promise<Probe> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: Probe = { sheets: wb.worksheets.map((w) => w.name).join(" | ") };
  out.hiddenSheets = wb.worksheets.filter((w) => w.state !== "visible").map((w) => w.name).join(",") || "none";
  const names = (wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model;
  out.definedNames = names.map((n) => `${n.name}=${n.ranges.join(",")}`).join("; ") || "none";
  let formulas = 0, cached = 0, comments = 0, links = 0, bold = 0, fills = 0, merges = 0, widths = 0, hiddenCols = 0, heights = 0, dv = 0, cf = 0, rich = 0, xlfn = 0, dummy = 0;
  const fmts = new Set<string>();
  const freeze: string[] = [];
  const tabColors: string[] = [];
  for (const ws of wb.worksheets) {
    merges += Object.keys((ws as unknown as { _merges: Record<string, unknown> })._merges ?? {}).length;
    ws.columns?.forEach((c) => {
      if (c.width) widths += 1;
      if (c.hidden) hiddenCols += 1;
    });
    if (ws.views?.some((v) => v.state === "frozen")) freeze.push(`${ws.name}(${ws.views.map((v) => `${(v as { xSplit?: number }).xSplit ?? 0},${(v as { ySplit?: number }).ySplit ?? 0}`).join()})`);
    cf += (ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings?.length ?? 0;
    const tab = ws.properties.tabColor as { argb?: string } | undefined;
    if (tab?.argb) tabColors.push(`${ws.name}:${tab.argb}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (row.height) heights += 1;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown as Record<string, unknown> | null;
        if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
          formulas += 1;
          if (v.result !== undefined) cached += 1;
          const f = String(v.formula ?? "");
          if (f.includes("_xlfn.")) xlfn += 1;
          if (f.includes("__xludf.DUMMYFUNCTION")) dummy += 1;
        }
        if (v && typeof v === "object" && "richText" in v) rich += 1;
        if (v && typeof v === "object" && "hyperlink" in v) links += 1;
        if (cell.note) comments += 1;
        if (cell.numFmt && cell.numFmt !== "General") fmts.add(cell.numFmt);
        if (cell.font?.bold) bold += 1;
        if (cell.fill && (cell.fill as { pattern?: string }).pattern && (cell.fill as { pattern?: string }).pattern !== "none") fills += 1;
        if (cell.dataValidation) dv += 1;
      });
    });
  }
  Object.assign(out, {
    formulas, cachedValues: cached, xlfnPrefixed: xlfn, googleDummyFunctions: dummy,
    numberFormats: [...fmts].join(" ‖ "), comments, hyperlinks: links, richText: rich,
    merges, colWidths: widths, hiddenCols, rowHeights: heights,
    freeze: freeze.join(",") || "none", dataValidation: dv, conditionalFormatting: cf,
    boldCells: bold, fillCells: fills, tabColors: tabColors.join(",") || "none",
  });
  return out;
}

const results: Record<string, Record<string, Probe | string>> = {};
for (const f of ["studio.exceljs.xlsx", "studio.libreoffice.xlsx", "studio.libreoffice.ods", "google-shape.xlsx"]) {
  const path = `${files}${f}`;
  results[f] = { sheetjs: probeSheetJS(path) };
  try {
    results[f].exceljs = f.endsWith(".ods") ? "ODS not supported" : await probeExcelJS(path);
  } catch (e) {
    results[f].exceljs = `error: ${(e as Error).message}`;
  }
}
writeFileSync(fileURLToPath(new URL("./probe-results.json", import.meta.url)), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 1));
