import type { ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import type { ButtonSizeProp } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuEntry, DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppSidebarPrimary } from "@/app-sidebar/src/app-sidebar-primary";
import "./sidebar-segmented-new-menu.css";

const SETTINGS_SEPARATOR: DropdownMenuEntry = { type: "separator", id: "app-settings-separator" };

export type SidebarSegmentedNewMenuSize = Extract<ButtonSizeProp, "md" | "xl">;

export type SidebarSegmentedNewMenuProps = {
  mainLabel: string;
  menuLabel: string;
  onMainAction: () => void;
  items?: readonly DropdownMenuItemProps[];
  /** Disables the primary action only; the chevron menu stays available. */
  mainDisabled?: boolean;
  /** BEM block. Calendar passes `calendar-new-menu` to keep existing CSS. */
  blockName?: string;
  className?: string;
  icon?: ReactNode;
  size?: SidebarSegmentedNewMenuSize;
  /** Stretch to the parent width. Sidebar primary stays content-sized. */
  stretch?: boolean;
};

export function SidebarSegmentedNewMenu({
  mainLabel,
  menuLabel,
  onMainAction,
  items = [],
  mainDisabled = false,
  blockName = "sidebar-segmented-new-menu",
  className,
  icon,
  size = "md",
  stretch = false,
}: SidebarSegmentedNewMenuProps) {
  // In the app sidebar: the app's Settings as the menu's last option (an app with no
  // other options gets the split button for it).
  const sidebar = useAppSidebarPrimary();
  const settingsItem = sidebar?.settingsItem ?? null;
  const menuItems: DropdownMenuEntry[] = settingsItem
    ? [...items, ...(items.length > 0 ? [SETTINGS_SEPARATOR] : []), settingsItem]
    : [...items];
  const hasMenu = menuItems.length > 0;
  const mainButton = (
    <Button
      label={mainLabel}
      icon={icon ?? <Plus />}
      onClick={onMainAction}
      size={size}
      pill
      variant="primary"
      disabled={mainDisabled}
      className={cn(
        hasMenu && `${blockName}__main`,
        !hasMenu && stretch && `${blockName}__main--stretch`,
      )}
    />
  );

  if (!hasMenu) return mainButton;

  return (
    <div className={cn(blockName, stretch && `${blockName}--stretch`, className)}>
      {mainButton}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            label={menuLabel}
            icon={<ChevronDown />}
            size={size}
            variant="primary"
            showTooltip={false}
            className={`${blockName}__menu`}
          />
        }
        items={menuItems}
      />
    </div>
  );
}
