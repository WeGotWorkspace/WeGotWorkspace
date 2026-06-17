import { useCallback } from "react";
import { TextEditorSource } from "@/text-editor-core/src/text-editor-source";
import { SpreadsheetFormulaBar } from "@/spreadsheet-core/src/spreadsheet-formula-bar";
import { SpreadsheetStatsFooter } from "@/spreadsheet-core/src/spreadsheet-stats-footer";
import {
  SpreadsheetGrid,
  type SpreadsheetGridSelection,
} from "@/spreadsheet-core/src/spreadsheet-grid";
import type { SpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";

type SpreadsheetMainPaneProps = {
  controller: SpreadsheetController;
  viewSource: boolean;
  onSourceEscapeBlur?: () => void;
};

export function SpreadsheetMainPane({
  controller,
  viewSource,
  onSourceEscapeBlur,
}: SpreadsheetMainPaneProps) {
  const handleActivateCell = useCallback(
    (p: { row: number; column: number }) => {
      // While picking, a grid click inserts a ref into the formula draft.
      if (controller.picking) {
        controller.insertRefAtCaret(controller.refForCell(p.row, p.column));
        return;
      }
      controller.setActiveCell(p);
    },
    [controller],
  );

  const handleSelect = useCallback(
    (sel: SpreadsheetGridSelection) => {
      controller.setSelection(sel);
      if (sel && sel.kind !== "cell") {
        controller.cancelFormulaEdit();
      }
    },
    [controller],
  );

  if (controller.loading) {
    return <p className="spreadsheet-workspace__loading">Loading…</p>;
  }
  if (controller.loadError) {
    return (
      <div className="spreadsheet-workspace__error">
        <p>{controller.labels.loadError}</p>
      </div>
    );
  }
  if (!controller.hasFile) {
    return (
      <div className="spreadsheet-workspace__empty">
        <p className="spreadsheet-workspace__empty-title">{controller.labels.emptyTitle}</p>
        <p className="spreadsheet-workspace__empty-description">
          {controller.labels.emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="spreadsheet-workspace__pane">
      <div className="spreadsheet-workspace__grid-area">
        <SpreadsheetFormulaBar controller={controller} />
        {controller.parseError ? (
          <div className="spreadsheet-workspace__parse-banner" role="status">
            {controller.parseError}
          </div>
        ) : null}
        <div className="spreadsheet-workspace__grid-wrap">
          <SpreadsheetGrid
            rawData={controller.rawData}
            computed={controller.computed}
            columnSettings={controller.columnSettings}
            defs={controller.defs}
            columnWidths={controller.columnWidths}
            onColumnResize={controller.setColumnWidth}
            viewOffset={controller.viewOffset}
            active={controller.activeCell}
            onActivateCell={handleActivateCell}
            onSelect={handleSelect}
            writeCell={controller.writeCell}
            onAddRow={controller.addRow}
            onAddColumn={controller.addColumn}
            addRowLabel={controller.labels.addRow}
            addColumnLabel={controller.labels.addColumn}
            picking={controller.picking}
          />
        </div>
        <SpreadsheetStatsFooter controller={controller} />
      </div>
      {viewSource ? (
        <div className="spreadsheet-workspace__source">
          <TextEditorSource
            value={controller.source}
            onChange={controller.onSourceChange}
            formatLabel="YCSV"
            indentWithSpaces
            escapeToBlur
            onEscapeBlur={onSourceEscapeBlur}
          />
        </div>
      ) : null}
    </div>
  );
}
