import { MoreHorizontal } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { DriveItemIconButton } from "@/drive-core/src/drive-item-icon-button";

export function DriveFileItemActionsMenu({
  actions,
  disabled = false,
}: {
  actions: ActionBarAction[];
  disabled?: boolean;
}) {
  return (
    <DropdownMenu
      align="end"
      sideOffset={6}
      contentClassName="min-w-40"
      items={actions.map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        onClick: action.onClick,
        checked: action.active,
        disabled: disabled || action.disabled,
        severity: action.severity ?? (action.id === "delete" ? "danger" : undefined),
        className: "cursor-pointer gap-2.5",
      }))}
      trigger={
        <DriveItemIconButton
          label="More actions"
          icon={<MoreHorizontal />}
          showTooltip={false}
          disabled={disabled}
        />
      }
    />
  );
}
