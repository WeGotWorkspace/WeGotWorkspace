import { WORKSPACE_LIST_SPACER_ATTR } from "@/workspace-list/src/use-workspace-list-measure";
import "./workspace-list.css";

/**
 * Stands in for rows that are not mounted. A component, not a bare `div`:
 * `SwipeableList` clones every child with its own props, which a DOM node would
 * receive as unknown attributes.
 */
export function WorkspaceListSpacer({ size }: { size: number }) {
  return (
    <div
      aria-hidden
      className="workspace-list__spacer"
      {...{ [WORKSPACE_LIST_SPACER_ATTR]: "" }}
      style={{ blockSize: size }}
    />
  );
}
