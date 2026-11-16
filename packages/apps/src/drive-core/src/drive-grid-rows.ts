import type { DriveFile } from "@/lib/files/drive-models";

/**
 * The Drive grid as list rows (#1641 step d): a section heading, then its tiles in
 * rows of `columns`. Each row is its own grid with the same auto-fill tracks, so
 * the columns line up as in one grid, and the list can mount only the rows near
 * the viewport.
 */
export type DriveGridSection = "folders" | "files";

export type DriveGridRowItem =
  | {
      kind: "header";
      key: string;
      section: DriveGridSection;
      /** A later section: the gap above it is its own padding (`drive-grid-section--after`). */
      after: boolean;
    }
  | {
      kind: "tiles";
      key: string;
      section: DriveGridSection;
      files: DriveFile[];
      /** The section's last row: no gap under it, as under a grid's last row. */
      last: boolean;
    };

/** Windowing starts above this many tiles, as a list does above 80 rows. */
export const DRIVE_GRID_WINDOW_AFTER_TILES = 80;

/**
 * Pitch estimates at a 16px root on a wide pane, before measuring. A tile is its
 * avatar plus 1.5rem (68px, its `min-height`), and a row has the 1rem gap under
 * it but the section's last row has none. A heading is the head bar and its
 * `mb-3` (60px), and a later section's heading also has the 2rem section gap
 * above it. Exact estimates keep the scroll height right before rows are measured.
 */
const TILE_ROW_ESTIMATE_PX = 84;
const LAST_TILE_ROW_ESTIMATE_PX = 68;
const HEADER_ESTIMATE_PX = 60;
const SECTION_GAP_ESTIMATE_PX = 32;

function chunk(files: readonly DriveFile[], columns: number): DriveFile[][] {
  const rows: DriveFile[][] = [];
  for (let start = 0; start < files.length; start += columns) {
    rows.push(files.slice(start, start + columns));
  }
  return rows;
}

/** Folders first, then files, as the grid shows them; empty sections are left out. */
export function driveGridRows(
  folders: readonly DriveFile[],
  files: readonly DriveFile[],
  columns: number,
): DriveGridRowItem[] {
  const out: DriveGridRowItem[] = [];
  const perRow = Math.max(1, Math.floor(columns));
  for (const [section, items] of [
    ["folders", folders],
    ["files", files],
  ] as const) {
    if (items.length === 0) continue;
    out.push({ kind: "header", key: `drive-grid-${section}`, section, after: out.length > 0 });
    const rows = chunk(items, perRow);
    rows.forEach((row, index) => {
      out.push({
        kind: "tiles",
        // The column count is in the key: rows of another width measure anew.
        key: `drive-grid-${perRow}-${row[0]!.id}`,
        section,
        files: row,
        last: index === rows.length - 1,
      });
    });
  }
  return out;
}

export const driveGridRowKey = (row: DriveGridRowItem) => row.key;
export const isDriveGridHeader = (row: DriveGridRowItem) => row.kind === "header";
export function driveGridRowEstimate(row: DriveGridRowItem): number {
  if (row.kind === "header") return HEADER_ESTIMATE_PX + (row.after ? SECTION_GAP_ESTIMATE_PX : 0);
  return row.last ? LAST_TILE_ROW_ESTIMATE_PX : TILE_ROW_ESTIMATE_PX;
}

/** Which row holds each tile, so focus and drag on a tile keep its row mounted. */
export function driveGridRowKeyByFileId(rows: readonly DriveGridRowItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.kind === "tiles") for (const file of row.files) map.set(file.id, row.key);
  }
  return map;
}

/**
 * The track count of a rendered grid row: `grid-template-columns` computes to one
 * length per track, auto-fill's empty tracks included. Null without layout (a
 * test DOM), where the value stays the `repeat()` as written.
 */
export function driveGridTrackCount(grid: Element): number | null {
  const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
  if (!tracks || tracks === "none" || tracks.includes("(")) return null;
  return tracks.split(/\s+/).length;
}
