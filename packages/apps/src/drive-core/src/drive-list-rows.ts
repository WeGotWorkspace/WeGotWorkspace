import type { DriveFile } from "@/lib/files/drive-models";

/** A Drive item's row key: its id, also its `data-list-item-id`. */
export const driveFileKey = (file: DriveFile) => file.id;

/**
 * A list row's pitch before it is measured, at a 16px root: `--list-row-height`
 * (3rem), its 1px hairline and the table's 0.125rem `border-spacing`. Exact, so
 * the scroll height matches the full list: measuring ignores changes under
 * 1.5px, and would never correct an estimate one pixel short.
 */
const DRIVE_LIST_ROW_ESTIMATE_PX = 51;

export const driveListRowEstimate = () => DRIVE_LIST_ROW_ESTIMATE_PX;
