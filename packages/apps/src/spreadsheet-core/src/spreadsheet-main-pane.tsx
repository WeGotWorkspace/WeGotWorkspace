import { useCallback } from "react";
import { TextEditorSource } from "@/text-editor-core/src/text-editor-source";
import { SpreadsheetFormulaBar } from "@/spreadsheet-core/src/spreadsheet-formula-bar";
import { SpreadsheetFormatBar } from "@/spreadsheet-core/src/spreadsheet-format-bar";
import { SpreadsheetSchemaPanel } from "@/spreadsheet-core/src/spreadsheet-schema-panel";
import { SpreadsheetStatsFooter } from "@/spreadsheet-core/src/spreadsheet-stats-footer";
import { SpreadsheetGrid } from "@/spreadsheet-core/src/spreadsheet-grid";
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
  const handleSelect = useCallback(
    (sel: Parameters<SpreadsheetController["onGridSelect"]>[0]) => {
      controller.onGridSelect(sel);
      if (sel && sel.kind !== "cell" && !controller.picking) {
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
        <SpreadsheetFormatBar
          labels={controller.labels}
          styleState={controller.selectionStyle}
          visible={controller.hasStyleSelection && !controller.picking}
          onBold={controller.toggleBoldOnSelection}
          onBorder={controller.toggleBorderOnSelection}
          onFill={controller.setFillOnSelection}
        />
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
            cells={controller.workbook.sheets[controller.activeSheetIndex]?.cells}
            defs={controller.defs}
            columnWidths={controller.columnWidths}
            onColumnResize={controller.setColumnWidth}
            viewOffset={controller.viewOffset}
            active={controller.activeCell}
            onActivateCell={controller.onGridActivate}
            onSelect={handleSelect}
            writeCell={controller.writeCell}
            onAddRow={controller.addRow}
            onAddColumn={controller.addColumn}
            addRowLabel={controller.labels.addRow}
            addColumnLabel={controller.labels.addColumn}
            picking={controller.picking}
            formulaHighlight={controller.formulaHighlight}
            formulaCaret={controller.fbCaret}
            onPickRef={controller.picking ? controller.insertRefAtCaret : undefined}
            onPickingArrow={controller.picking ? controller.onPickingArrow : undefined}
            sheets={controller.sheets.map((s) => ({
              ref: s.ref,
              name: s.name,
              columnSettings: s.columnSettings,
            }))}
            activeSheetRef={controller.activeSheetRef}
          />
        </div>
        <SpreadsheetStatsFooter controller={controller} />
      </div>
      {controller.schemaPanelOpen ? (
        <SpreadsheetSchemaPanel
          workbook={controller.workbook}
          activeSheetIndex={controller.activeSheetIndex}
          labels={controller.labels}
          onDefsChange={controller.updateDefs}
          onColumnsChange={controller.updateColumnSettings}
        />
      ) : null}
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
