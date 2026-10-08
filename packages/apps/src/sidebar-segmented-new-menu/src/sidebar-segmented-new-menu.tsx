import type { ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import type { ButtonSizeProp } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { cn } from "@/lib/utils";
import "./sidebar-segmented-new-menu.css";

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
  const hasMenu = items.length > 0;
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
        items={[...items]}
      />
    </div>
  );
}
