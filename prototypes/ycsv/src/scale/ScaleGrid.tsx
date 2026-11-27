import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatValue } from "../ycsv-grid/format";
import type { SheetEngine } from "./engine";
import "./ScaleGrid.css";

/**
 * Row + column windowed grid for spike 4. Fixed row height and column width, so the
 * window is plain arithmetic (the suite's `workspace-list-window.ts` does the same with
 * prefix sums for variable heights). Cells are absolutely positioned inside a sizer.
 */
export const ROW_HEIGHT = 28;
export const COL_WIDTH = 120;
export const HEADER_HEIGHT = 30;
const OVERSCAN_ROWS = 8;
const OVERSCAN_COLS = 2;

type Props = { engine: SheetEngine; height: number; width: number; onPainted?: () => void };

export function windowRange(scroll: number, viewport: number, size: number, count: number, overscan: number) {
  const start = Math.max(0, Math.floor(scroll / size) - overscan);
  const end = Math.min(count, Math.ceil((scroll + viewport) / size) + overscan);
  return { start, end };
}

export function ScaleGrid({ engine, height, width, onPainted }: Props) {
  const version = useSyncExternalStore(engine.subscribe, engine.getVersion);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { columns, rowIds } = engine;
  const rows = windowRange(scroll.top, height - HEADER_HEIGHT, ROW_HEIGHT, rowIds.length, OVERSCAN_ROWS);
  const cols = windowRange(scroll.left, width, COL_WIDTH, columns.length, OVERSCAN_COLS);

  useLayoutEffect(() => {
    onPainted?.();
  });

  const header = useMemo(() => {
    const out = [];
    for (let c = cols.start; c < cols.end; c += 1) {
      const column = columns[c];
      if (!column) continue;
      out.push(
        <div key={column.colId} className="sg-head" style={{ left: c * COL_WIDTH, width: COL_WIDTH }}>
          {column.name ?? column.ref}
        </div>,
      );
    }
    return out;
  }, [columns, cols.start, cols.end]);

  const cells = [];
  for (let r = rows.start; r < rows.end; r += 1) {
    const rowId = rowIds[r];
    if (!rowId) continue;
    for (let c = cols.start; c < cols.end; c += 1) {
      const column = columns[c];
      if (!column) continue;
      const value = engine.valueAt(r, c);
      cells.push(
        <div
          key={`${rowId}|${column.colId}`}
          className="sg-cell"
          data-r={r}
          style={{ top: HEADER_HEIGHT + r * ROW_HEIGHT, left: c * COL_WIDTH, width: COL_WIDTH, height: ROW_HEIGHT }}
        >
          {formatValue(value, column)}
        </div>,
      );
    }
  }

  return (
    <div
      ref={scrollerRef}
      className="sg-scroller"
      data-scroller=""
      data-version={version}
      style={{ height, width }}
      onScroll={(event) => {
        const target = event.currentTarget;
        setScroll({ top: target.scrollTop, left: target.scrollLeft });
      }}
    >
      <div
        className="sg-sizer"
        style={{ height: HEADER_HEIGHT + rowIds.length * ROW_HEIGHT, width: columns.length * COL_WIDTH }}
      >
        <div className="sg-header" style={{ width: columns.length * COL_WIDTH }}>
          {header}
        </div>
        {cells}
      </div>
    </div>
  );
}
