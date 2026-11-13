import { WORKSPACE_LIST_SPACER_ATTR } from "@/workspace-list/src/use-workspace-list-measure";

/**
 * Stands in for the list rows that are not mounted (#1641 step d): one table row
 * as tall as they are. The table's `border-spacing` adds its gap above the spacer
 * as it does above every row, so the spacer is that much shorter.
 */
export function DriveListSpacer({ size, columns }: { size: number; columns: number }) {
  return (
    <tr aria-hidden className="drive-list-spacer" {...{ [WORKSPACE_LIST_SPACER_ATTR]: "" }}>
      <td
        colSpan={columns}
        style={{ height: `max(0px, calc(${size}px - var(--drive-list-row-gap, 0px)))` }}
      />
    </tr>
  );
}
