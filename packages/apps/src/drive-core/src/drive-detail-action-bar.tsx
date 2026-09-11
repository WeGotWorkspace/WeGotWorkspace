import { MoreHorizontal } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";

type DriveDetailActionBarProps = {
  actions: ActionBarAction[];
};

/**
 * File actions for DocsCollabSidebarPanel `headerActions`: single ⋯ menu.
 * Close lives in the shared panel `titleTrailing` (gap-3 after this cluster).
 */
export function DriveDetailActionBar({ actions }: DriveDetailActionBarProps) {
  if (actions.length === 0) return null;

  return (
    <div className="drive-detail-panel__actions" role="group" aria-label="File actions">
      <DropdownMenu
        align="end"
        sideOffset={10}
        items={actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: <span className="drive-detail-panel__actions-menu-icon">{action.icon}</span>,
          onClick: action.onClick,
          checked: action.active,
          disabled: action.disabled,
          severity: action.severity,
        }))}
        contentClassName="min-w-[11rem] p-1.5"
        trigger={
          <IconButton label="More actions" icon={<MoreHorizontal />} size="sm" variant="outline" />
        }
      />
    </div>
  );
}
