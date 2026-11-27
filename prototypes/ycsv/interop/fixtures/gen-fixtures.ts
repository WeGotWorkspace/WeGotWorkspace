// Generates the spike 11 XLSX fixtures with exceljs, then LibreOffice-written copies
// (xlsx + ods + csv) with `soffice --headless`, which also fills in cached values.
//   pnpm exec vite-node interop/fixtures/gen-fixtures.ts
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const out = fileURLToPath(new URL("./files/", import.meta.url));
mkdirSync(out, { recursive: true });

const EUR = '"€"\\ #,##0.00;[Red]\\-"€"\\ #,##0.00';

async function studioWorkbook(path: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "spike-11";
  wb.created = new Date(Date.UTC(2026, 10, 27));

  // --- Producten: a clean table with a header row --------------------------------------
  const p = wb.addWorksheet("Producten", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }], properties: { tabColor: { argb: "FF2E7D32" } } });
  p.columns = [
    { header: "Product", key: "product", width: 22 },
    { header: "Categorie", key: "cat", width: 14 },
    { header: "Prijs", key: "prijs", width: 12, style: { numFmt: EUR } },
    { header: "Aantal", key: "aantal", width: 9, style: { numFmt: "0" } },
    { header: "Totaal", key: "totaal", width: 14, style: { numFmt: EUR } },
    { header: "BTW", key: "btw", width: 12, style: { numFmt: EUR } },
    { header: "Datum", key: "datum", width: 12, style: { numFmt: "dd-mm-yyyy" } },
    { header: "Marge", key: "marge", width: 9, style: { numFmt: "0.0%" } },
    { header: "Actief", key: "actief", width: 8 },
  ];
  const data: [string, string, number, number, Date, number, boolean][] = [
    ["Appels", "fruit", 0.45, 6, new Date(Date.UTC(2026, 0, 5)), 0.18, true],
    ["Brood", "bakkerij", 2.99, 2, new Date(Date.UTC(2026, 0, 6)), 0.32, true],
    ["Melk", "zuivel", 1.19, 3, new Date(Date.UTC(2026, 1, 1)), 0.25, false],
    ["Kaas", "zuivel", 8.5, 1, new Date(Date.UTC(2026, 1, 28)), 0.41, true],
    ["Peren", "fruit", 0.6, 12, new Date(Date.UTC(2026, 2, 31)), 0.2, true],
  ];
  data.forEach(([product, cat, prijs, aantal, datum, marge, actief], i) => {
    const r = i + 2;
    p.addRow({ product, cat, prijs, aantal, totaal: { formula: `C${r}*D${r}` }, btw: { formula: `E${r}*BTW_TARIEF` }, datum, marge, actief });
  });
  p.addRow({ product: "Totaal", totaal: { formula: "SUM(E2:E6)" }, btw: { formula: "SUM(F2:F6)" }, marge: { formula: "AVERAGE(H2:H6)" } });
  p.getRow(1).font = { bold: true };
  p.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
  p.getRow(7).font = { bold: true };
  p.getCell("E7").border = { top: { style: "double" } };
  p.getCell("C2").note = "Prijs per stuk, incl. korting";
  p.getCell("B2").dataValidation = { type: "list", allowBlank: false, formulae: ["Categorieën!$A$2:$A$4"] };
  for (let r = 2; r <= 6; r++) {
    p.getCell(`B${r}`).dataValidation = { type: "list", allowBlank: false, formulae: ["Categorieën!$A$2:$A$4"] };
    p.getCell(`D${r}`).dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [0, 1000], showErrorMessage: true };
  }
  p.addConditionalFormatting({
    ref: "D2:D6",
    rules: [{ type: "cellIs", operator: "lessThan", formulae: ["5"], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFF3CD" } } } }],
  });
  p.autoFilter = "A1:I6";

  // --- Categorieën: lookup table -------------------------------------------------------
  const c = wb.addWorksheet("Categorieën");
  c.addRow(["Id", "Label", "Korting"]);
  c.addRow(["fruit", "Fruit", 0.1]);
  c.addRow(["bakkerij", "Bakkerij", 0]);
  c.addRow(["zuivel", "Zuivel", 0.05]);
  c.getColumn(3).numFmt = "0%";
  wb.definedNames.add("Categorieën!$A$2:$C$4", "Cats");

  // --- Instellingen: hidden settings sheet with a named constant cell -----------------
  const s = wb.addWorksheet("Instellingen", { state: "hidden" });
  s.addRow(["BTW tarief", 0.21]);
  s.getCell("B1").numFmt = "0%";
  wb.definedNames.add("Instellingen!$B$1", "BTW_TARIEF");

  // --- Q1 overzicht: report-style grid (title, merged cells, labels in column A) -------
  const o = wb.addWorksheet("Q1 overzicht", { views: [{ state: "frozen", ySplit: 3 }] });
  o.getColumn(1).width = 34;
  o.getColumn(2).width = 18;
  o.getColumn(3).hidden = true;
  o.mergeCells("A1:D1");
  o.getCell("A1").value = "Overzicht Q1 2026";
  o.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A237E" } };
  o.getCell("A1").alignment = { horizontal: "center" };
  o.getRow(1).height = 28;
  const rows: [string, ExcelJS.CellValue, string?][] = [
    ["Omzet (SUM over tab)", { formula: "SUM(Producten!E2:E6)" }, EUR],
    ["Omzet incl. BTW, afgerond", { formula: "ROUND(B4*(1+BTW_TARIEF),2)" }, EUR],
    ["Korting fruit (VLOOKUP)", { formula: 'VLOOKUP("fruit",Cats,3,FALSE)' }, "0%"],
    ["Korting zuivel (XLOOKUP)", { formula: '_xlfn.XLOOKUP("zuivel",Categorieën!A2:A4,Categorieën!C2:C4,"?")' }, "0%"],
    ["Label via INDEX/MATCH", { formula: 'IFERROR(INDEX(Categorieën!$B$2:$B$4,MATCH("zuivel",Categorieën!$A$2:$A$4,0)),"-")' }],
    ["Aantal fruit (COUNTIF)", { formula: 'COUNTIF(Producten!B2:B6,"fruit")' }, "0"],
    ["Omzet fruit actief (SUMIFS)", { formula: 'SUMIFS(Producten!E2:E6,Producten!B2:B6,"fruit",Producten!I2:I6,TRUE)' }, EUR],
    ["Gemiddelde prijs", { formula: "AVERAGE(Producten!C2:C6)" }, EUR],
    ["SUMPRODUCT prijs x aantal", { formula: "SUMPRODUCT(Producten!C2:C6,Producten!D2:D6)" }, EUR],
    ["Hele kolom SUM(E:E) min totaal", { formula: "SUM(Producten!E:E)-Producten!E7" }, EUR],
    ["Absolute ref $C$2*D2", { formula: "Producten!$C$2*Producten!D2" }, EUR],
    ["Concat &", { formula: 'Producten!A2&" ("&Producten!B2&")"' }],
    ["TEXTJOIN", { formula: '_xlfn.TEXTJOIN(", ",TRUE,Producten!A2:A4)' }],
    ["Percent literal 50%*B4", { formula: "50%*B4" }, EUR],
    ["Eerste datum", { formula: "MIN(Producten!G2:G6)" }, "dd-mm-yyyy"],
    ["Dagen tussen eerste en laatste", { formula: "MAX(Producten!G2:G6)-MIN(Producten!G2:G6)" }, "0"],
    ["Einde maand (EOMONTH)", { formula: "EOMONTH(Producten!G2,0)" }, "dd-mm-yyyy"],
    ["Werkdagen (NETWORKDAYS)", { formula: "NETWORKDAYS(Producten!G2,Producten!G6)" }, "0"],
    ["Datum als tekst (TEXT)", { formula: 'TEXT(Producten!G2,"dd-mm-yyyy")' }],
    ["IF/AND", { formula: 'IF(AND(B4>10,B9<5),"ok","check")' }],
    ["Deling door nul", { formula: "1/0" }],
    ["IFERROR rond deling", { formula: 'IFERROR(1/0,"n.v.t.")' }],
    ["Vandaag (volatile)", { formula: "TODAY()" }, "dd-mm-yyyy"],
    ["Tekst die op een getal lijkt", "007"],
    ["Groot getal", 1e20, "0.00E+00"],
    ["Negatief, boekhoudnotatie", -1234.5, "#,##0.00;(#,##0.00)"],
    ["Tijd", 0.395833333333333, "hh:mm"],
    ["Hyperlink", { text: "WeGotWorkspace", hyperlink: "https://example.org/" }],
    ["Rich text", { richText: [{ text: "vet ", font: { bold: true } }, { text: "en cursief", font: { italic: true } }] }],
    ["Fout als waarde", { error: "#N/A" }],
  ];
  o.getCell("A3").value = "Kengetal";
  o.getCell("B3").value = "Waarde";
  o.getRow(3).font = { bold: true };
  rows.forEach(([label, value, fmt], i) => {
    const r = i + 4;
    o.getCell(`A${r}`).value = label;
    o.getCell(`B${r}`).value = value;
    if (fmt) o.getCell(`B${r}`).numFmt = fmt;
  });
  o.getCell("A20").note = "Sheet-level notitie";
  wb.definedNames.add("'Q1 overzicht'!$B$4", "Omzet");
  await wb.xlsx.writeFile(path);
}

// A workbook in the shape Google Sheets exports: functions Excel lacks are wrapped as
// IFERROR(__xludf.DUMMYFUNCTION("…"), <cached value>), notes become comments. Synthesised
// from Google's documented/observed export shape, not exported from a real Google account.
async function googleShapeWorkbook(path: string) {
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet("Sheet1");
  sh.addRow(["Item", "Bedrag", "Koers", "Gefilterd"]);
  sh.addRow(["A", 10, { formula: 'IFERROR(__xludf.DUMMYFUNCTION("GOOGLEFINANCE(""CURRENCY:EURUSD"")"),1.08)', result: 1.08 }, { formula: 'IFERROR(__xludf.DUMMYFUNCTION("FILTER(A2:B4,B2:B4>15)"),"B")', result: "B" }]);
  sh.addRow(["B", 20, { formula: 'IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),1.08)', result: 1.08 }, { formula: "B3*2", result: 40 }]);
  sh.addRow(["C", 30, null, { formula: 'IFERROR(__xludf.DUMMYFUNCTION("ARRAYFORMULA(B2:B4*2)"),20)', result: 20 }]);
  sh.addRow(["Som", { formula: "SUM(B2:B4)", result: 60 }]);
  sh.getCell("A2").note = "Opmerking van een collega";
  sh.getColumn(1).width = 12;
  await wb.xlsx.writeFile(path);
}

function soffice(args: string[], cwd: string) {
  const profile = mkdtempSync(join(tmpdir(), "lo-profile-"));
  try {
    execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", ...args], { cwd, stdio: "pipe", timeout: 120_000 });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

await studioWorkbook(join(out, "studio.exceljs.xlsx"));
await googleShapeWorkbook(join(out, "google-shape.xlsx"));

// LibreOffice copies: open the exceljs file, recalculate, save as xlsx / ods / csv.
const work = mkdtempSync(join(tmpdir(), "lo-out-"));
try {
  copyFileSync(join(out, "studio.exceljs.xlsx"), join(work, "studio.xlsx"));
  soffice(["--convert-to", "ods", "--outdir", join(work, "ods"), "studio.xlsx"], work);
  soffice(["--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(work, "xlsx"), join(work, "ods", "studio.ods")], work);
  // CSV of every sheet: filter options 44,34,76 = comma, double quote, UTF-8; -1 = all sheets.
  soffice(["--convert-to", 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1', "--outdir", join(work, "csv"), join(work, "ods", "studio.ods")], work);
  copyFileSync(join(work, "ods", "studio.ods"), join(out, "studio.libreoffice.ods"));
  copyFileSync(join(work, "xlsx", "studio.xlsx"), join(out, "studio.libreoffice.xlsx"));
  mkdirSync(join(out, "csv"), { recursive: true });
  for (const f of existsSync(join(work, "csv")) ? readdirSync(join(work, "csv")) : []) copyFileSync(join(work, "csv", f), join(out, "csv", f));
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(readdirSync(out));
