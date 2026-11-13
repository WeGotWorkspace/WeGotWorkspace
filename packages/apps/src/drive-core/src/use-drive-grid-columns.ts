import { useLayoutEffect, useState } from "react";
import { driveGridTrackCount } from "@/drive-core/src/drive-grid-rows";

/**
 * How many tiles fit in a row of the windowed Drive grid (#1641 step d), read
 * from a rendered row's auto-fill tracks when the grid mounts and whenever its
 * width changes. Starts at one: the first read comes before the first paint.
 */
export function useDriveGridColumns(layout: HTMLElement | null, enabled: boolean): number {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    if (!layout || !enabled) return;
    const read = () => {
      const row = layout.querySelector(".drive-grid");
      const count = row ? driveGridTrackCount(row) : null;
      if (count) setColumns(count);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(layout);
    return () => observer.disconnect();
  }, [enabled, layout]);
  return columns;
}
