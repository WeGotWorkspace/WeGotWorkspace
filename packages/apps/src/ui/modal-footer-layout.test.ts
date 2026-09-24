import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function read(name: string) {
  return readFileSync(join(here, name), "utf8");
}

describe("modal footer action layout", () => {
  it("keeps Dialog, AlertDialog, and Sheet footers in a horizontal row at all breakpoints", () => {
    for (const name of ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx"] as const) {
      const source = read(name);
      expect(source).toMatch(/flex flex-row justify-end gap-2/);
      expect(source).not.toMatch(/flex-col-reverse/);
      expect(source).not.toMatch(/sm:flex-row/);
    }
  });

  it("does not add stacked-footer margin on AlertDialogCancel", () => {
    const source = read("alert-dialog.tsx");
    expect(source).not.toMatch(/mt-2 sm:mt-0/);
  });
});
