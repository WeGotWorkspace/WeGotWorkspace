import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { Plus } from "lucide-react";
import type { DataEditorRef } from "@glideapps/glide-data-grid";
import { IconButton } from "@/button/src/button";

type ControlRect = { left: number; top: number; width: number; height: number };

const CONTROL_SIZE = 28;
/** Gap between grid boundary and insert control (reads as "after" last column/row). */
const INSERT_EDGE_GAP = 2;

type SpreadsheetGridInsertControlsProps = {
  gridRef: RefObject<DataEditorRef | null>;
  containerRef: RefObject<HTMLElement | null>;
  colCount: number;
  rowCount: number;
  columnWidths: readonly number[];
  layoutEpoch: number;
  addRowLabel: string;
  addColumnLabel: string;
  onAddRow: () => void;
  onAddColumn: () => void;
};

type ScreenRect = { x: number; y: number; width: number; height: number };

function headerInsertBand(
  grid: DataEditorRef,
  colCount: number,
  columnWidths: readonly number[],
  canvasRect: DOMRect,
): ScreenRect | null {
  const lastHeader = grid.getBounds(colCount - 1, -1);
  if (lastHeader && lastHeader.width > 0) return lastHeader;

  const firstHeader = grid.getBounds(0, -1);
  const lastCell = grid.getBounds(colCount - 1, 0);
  if (firstHeader && lastCell && lastCell.width > 0) {
    return {
      x: lastCell.x,
      y: firstHeader.y,
      width: lastCell.width,
      height: firstHeader.height,
    };
  }

  const firstCell = grid.getBounds(0, 0);
  if (!firstHeader || !firstCell || colCount < 1) return null;

  const rowMarkerWidth = Math.max(0, firstCell.x - canvasRect.x);
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  return {
    x: canvasRect.x + rowMarkerWidth + totalWidth - (columnWidths[colCount - 1] ?? 0),
    y: firstHeader.y,
    width: columnWidths[colCount - 1] ?? 0,
    height: firstHeader.height,
  };
}

/** Positions add-row / add-column buttons on Glide header and row-marker chrome. */
export function SpreadsheetGridInsertControls({
  gridRef,
  containerRef,
  colCount,
  rowCount,
  columnWidths,
  layoutEpoch,
  addRowLabel,
  addColumnLabel,
  onAddRow,
  onAddColumn,
}: SpreadsheetGridInsertControlsProps) {
  const [addColumnRect, setAddColumnRect] = useState<ControlRect | null>(null);
  const [addRowRect, setAddRowRect] = useState<ControlRect | null>(null);

  const measure = useCallback(() => {
    const grid = gridRef.current;
    const container = containerRef.current;
    if (!grid || !container || colCount < 1 || rowCount < 1) {
      setAddColumnRect(null);
      setAddRowRect(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const canvas =
      container.querySelector<HTMLCanvasElement>('[data-testid="data-grid-canvas"]') ??
      container.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
      setAddColumnRect(null);
      setAddRowRect(null);
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    let lastRowMarker = grid.getBounds(-1, rowCount - 1);
    if (!lastRowMarker) {
      const lastRow = grid.getBounds(0, rowCount - 1);
      if (lastRow) {
        const rowMarkerWidth = Math.max(CONTROL_SIZE + 4, lastRow.x - canvasRect.x);
        lastRowMarker = {
          x: canvasRect.x,
          y: lastRow.y,
          width: rowMarkerWidth,
          height: lastRow.height,
        };
      }
    }
    const headerBand = headerInsertBand(grid, colCount, columnWidths, canvasRect);

    if (headerBand && headerBand.width > 0) {
      const headerRight = headerBand.x + headerBand.width;
      setAddColumnRect({
        // After last column right edge: bounds.right + gap (not centered into header label).
        left: headerRight - containerRect.left + INSERT_EDGE_GAP,
        top: headerBand.y - containerRect.top + (headerBand.height - CONTROL_SIZE) / 2,
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
      });
    } else {
      setAddColumnRect(null);
    }

    if (lastRowMarker) {
      const rowMarkerBottom = lastRowMarker.y + lastRowMarker.height;
      setAddRowRect({
        left: lastRowMarker.x - containerRect.left + (lastRowMarker.width - CONTROL_SIZE) / 2,
        // Below last row marker bottom edge, centered in marker column.
        top: rowMarkerBottom - containerRect.top + INSERT_EDGE_GAP,
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
      });
    } else {
      setAddRowRect(null);
    }
  }, [colCount, columnWidths, containerRef, gridRef, rowCount]);

  useLayoutEffect(() => {
    measure();
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const raf2 = requestAnimationFrame(schedule);

    const container = containerRef.current;
    if (!container) {
      return () => {
        cancelAnimationFrame(raf);
        cancelAnimationFrame(raf2);
      };
    }

    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, attributes: true });

    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, measure, layoutEpoch]);

  return (
    <>
      {addColumnRect ? (
        <IconButton
          className="spreadsheet-grid__insert-control spreadsheet-grid__insert-control--column"
          style={{
            left: addColumnRect.left,
            top: addColumnRect.top,
            width: addColumnRect.width,
            height: addColumnRect.height,
          }}
          size="xs"
          variant="subtle"
          label={addColumnLabel}
          showTooltip={false}
          icon={<Plus className="size-3.5" aria-hidden />}
          onClick={onAddColumn}
        />
      ) : null}
      {addRowRect ? (
        <IconButton
          className="spreadsheet-grid__insert-control spreadsheet-grid__insert-control--row"
          style={{
            left: addRowRect.left,
            top: addRowRect.top,
            width: addRowRect.width,
            height: addRowRect.height,
          }}
          size="xs"
          variant="subtle"
          label={addRowLabel}
          showTooltip={false}
          icon={<Plus className="size-3.5" aria-hidden />}
          onClick={onAddRow}
        />
      ) : null}
    </>
  );
}
