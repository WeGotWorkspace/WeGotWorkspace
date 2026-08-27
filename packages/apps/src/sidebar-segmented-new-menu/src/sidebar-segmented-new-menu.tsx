import { ChevronDown, Plus } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { cn } from "@/lib/utils";
import "./sidebar-segmented-new-menu.css";

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
};

export function SidebarSegmentedNewMenu({
  mainLabel,
  menuLabel,
  onMainAction,
  items = [],
  mainDisabled = false,
  blockName = "sidebar-segmented-new-menu",
  className,
}: SidebarSegmentedNewMenuProps) {
  const hasMenu = items.length > 0;
  const mainButton = (
    <Button
      label={mainLabel}
      icon={<Plus />}
      onClick={onMainAction}
      size="lg"
      pill
      variant="primary"
      disabled={mainDisabled}
      className={hasMenu ? `${blockName}__main` : `${blockName}__main--solo`}
    />
  );

  if (!hasMenu) return mainButton;

  return (
    <div className={cn(blockName, className)}>
      {mainButton}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            label={menuLabel}
            icon={<ChevronDown />}
            size="lg"
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
