import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_YCSV } from "@/spreadsheet-core/src/fixtures/sample-sheet";
import { mergeSpreadsheetLabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import { SpreadsheetSchemaPanel } from "@/spreadsheet-core/src/spreadsheet-schema-panel";
import { parseYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";
import { TooltipProvider } from "@/ui/tooltip";
import "@/spreadsheet-core/src/spreadsheet-workspace.css";

const labels = mergeSpreadsheetLabels();

function renderPanel(workbook = parseYcsv(SAMPLE_YCSV)) {
  return render(
    <TooltipProvider>
      <div className="spreadsheet-workspace">
        <SpreadsheetSchemaPanel
          workbook={workbook}
          activeSheetIndex={0}
          labels={labels}
          onDefsChange={vi.fn()}
          onColumnsChange={vi.fn()}
        />
      </div>
    </TooltipProvider>,
  );
}

describe("SpreadsheetSchemaPanel", () => {
  it("keeps mapping key input focused while typing", () => {
    const workbook = parseYcsv(SAMPLE_YCSV);
    workbook.defs = { ...workbook.defs, status_map: { key: "Label" } };
    renderPanel(workbook);

    const keyInput = screen.getByLabelText(labels.schemaMappingKey);
    keyInput.focus();

    for (const value of ["ke", "key", "keye", "keyex", "keyextra"]) {
      fireEvent.change(keyInput, { target: { value } });
      expect(document.activeElement).toBe(keyInput);
    }

    expect(keyInput).toHaveProperty("value", "keyextra");
  });
});
