// Spike 11: Apple Numbers. `pnpm vitest run interop/xlsx/numbers.test.ts`
// Needs interop.test.ts to have run first (it writes the YCSV exports in fixtures/out/).
//
// 1. Numbers' own computed values (its XLSX export of the studio workbook) vs LibreOffice's.
// 2. YCSV → Numbers: our exceljs XLSX and SheetJS .numbers exports are opened in Numbers
//    (osascript), re-exported by Numbers as XLSX, and compared with LibreOffice's values.
//    Opt-in with NUMBERS_E2E=1 (needs Numbers 15). Unreliable: see the report.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import ZAHL from "xlsx/dist/xlsx.zahl.mjs";
import { expect, test } from "vitest";
import { readAmended, toSheetJS } from "./export";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FILES = here("../fixtures/files/");
const OUT = here("../fixtures/out/");
// Numbers 15 ("Numbers Creator Studio", com.apple.Numbers). Numbers 14.5 (com.apple.iWork.Numbers)
// may be installed next to it under the same AppleScript name, so always address it by bundle id.
const NUMBERS_ID = "com.apple.Numbers";
// Opt-in (NUMBERS_E2E=1): driving Numbers from a test proved fragile (see docs/spike-11-interop.md).
const NUMBERS_APP = process.env.NUMBERS_E2E === "1" && existsSync("/Applications/Numbers Creator Studio.app") ? NUMBERS_ID : undefined;
const BOX = join(tmpdir(), "spike11-numbers");

type Vals = Map<string, unknown>;

/** sheet!A1 → cached value, for every non-empty cell. Sheet names without Numbers' " - Table 1". */
function values(path: string): { vals: Vals; formulas: number; sheets: string[] } {
  const wb = XLSX.read(readFileSync(path), { cellFormula: true });
  const vals: Vals = new Map();
  let formulas = 0;
  const sheets: string[] = [];
  for (const name of wb.SheetNames) {
    if (name === "Export Summary") continue;
    const sheet = name.replace(/ - Table 1$/, "");
    sheets.push(sheet);
    for (const [k, c] of Object.entries(wb.Sheets[name]!)) {
      if (k.startsWith("!")) continue;
      const cell = c as XLSX.CellObject;
      if (cell.f) formulas += 1;
      if (cell.t === "z") continue;
      vals.set(`${sheet}!${k}`, cell.t === "e" ? `#ERR` : cell.v);
    }
  }
  return { vals, formulas, sheets };
}

function compare(ref: Vals, got: Vals) {
  let same = 0;
  const diffs: string[] = [];
  for (const [k, v] of ref) {
    const w = got.get(k);
    const ok = typeof v === "number" && typeof w === "number" ? Math.abs(v - w) < 1e-9 * Math.max(1, Math.abs(v)) || (Math.abs(v - w) < 1e-6) : v === w;
    if (ok) same += 1;
    else diffs.push(`${k}: ${JSON.stringify(v)} → ${JSON.stringify(w)}`);
  }
  return { cells: ref.size, same, diffs };
}

/**
 * Open `file` in Numbers, export it as XLSX, close it. AppleScript's own `open` never returns
 * for an XLSX (Numbers shows import warnings), so the file is opened via Launch Services and
 * the script waits for the document to appear.
 */
function throughNumbers(file: string, outBase: string): void {
  const doc = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  execFileSync("open", ["-g", "-b", NUMBERS_ID, file]);
  const script = `
on run argv
  tell application id "com.apple.Numbers"
    repeat 120 times
      if (name of every document) contains (item 1 of argv) then exit repeat
      delay 1
    end repeat
    with timeout of 180 seconds
      set d to document (item 1 of argv)
      export d to POSIX file (item 2 of argv & ".xlsx") as Microsoft Excel
      close d saving no
    end timeout
  end tell
end run`;
  execFileSync("osascript", ["-e", script, doc, outBase], { stdio: "pipe", timeout: 300_000 });
}

test("Apple Numbers", async () => {
  const results: Record<string, unknown> = {};
  // LibreOffice's values of the studio workbook (cached values in its XLSX conversion).
  const reference = values(join(FILES, "studio.libreoffice.xlsx"));

  // 1. Numbers' values for the same workbook (Numbers opened studio.exceljs.xlsx, exported XLSX).
  const numbersOwn = values(join(FILES, "numbers/studio.from-xlsx.numbers.xlsx"));
  results.numbersComputes = { ...compare(reference.vals, numbersOwn.vals), formulasKept: numbersOwn.formulas, formulasInOriginal: reference.formulas };

  // SheetJS CE reading .numbers: values vs LibreOffice reference (formulas are not read).
  const fromNumbers = values(join(FILES, "numbers/studio.from-xlsx.numbers"));
  results.sheetjsReadsNumbers = { ...compare(reference.vals, fromNumbers.vals), formulas: fromNumbers.formulas };

  // 2. YCSV → .numbers with SheetJS (template payload "zahl").
  const amended = readAmended(readFileSync(join(OUT, "studio_libreoffice_xlsx.ycsv"), "utf8"));
  const sjs = toSheetJS(amended);
  const numbersOut = join(OUT, "studio_libreoffice_xlsx.sheetjs.numbers");
  let writeError: string | undefined;
  try {
    writeFileSync(numbersOut, XLSX.write(sjs, { bookType: "numbers", type: "buffer", numbers: ZAHL } as XLSX.WritingOptions));
  } catch (e) {
    writeError = (e as Error).message;
  }
  results.sheetjsWritesNumbers = writeError ? { error: writeError } : { bytes: readFileSync(numbersOut).length };

  if (NUMBERS_APP) {
    rmSync(BOX, { recursive: true, force: true });
    mkdirSync(BOX, { recursive: true });
    try {
      const inputs: Record<string, string> = { exceljsXlsx: join(OUT, "studio_libreoffice_xlsx.exceljs.xlsx") };
      if (!writeError) inputs.sheetjsNumbers = numbersOut;
      const opened: Record<string, unknown> = {};
      for (const [k, path] of Object.entries(inputs)) {
        const inBox = join(BOX, `${k}${path.slice(path.lastIndexOf("."))}`);
        copyFileSync(path, inBox);
        try {
          throughNumbers(inBox, join(BOX, `${k}.via-numbers`));
          const back = values(join(BOX, `${k}.via-numbers.xlsx`));
          copyFileSync(join(BOX, `${k}.via-numbers.xlsx`), join(OUT, `studio_libreoffice_xlsx.${k}.via-numbers.xlsx`));
          opened[k] = { ...compare(reference.vals, back.vals), formulasKept: back.formulas, sheets: back.sheets };
        } catch (e) {
          opened[k] = { error: String((e as Error).message).slice(0, 300) };
        }
      }
      results.openedInNumbers = opened;
    } finally {
      rmSync(BOX, { recursive: true, force: true });
    }
  } else results.openedInNumbers = "skipped (set NUMBERS_E2E=1 with Numbers 15 installed)";

  writeFileSync(here("./numbers-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  expect(results.numbersComputes).toBeTruthy();
}, 900_000);
