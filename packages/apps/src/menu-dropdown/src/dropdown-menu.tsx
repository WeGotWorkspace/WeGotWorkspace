import {
  DropdownMenu as RadixDropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { MenuItem, type MenuItemProps } from "@/menu-item/src/menu-item";
import { cn } from "@/lib/utils";
import "@/menu-dropdown/src/dropdown-menu.css";

export type DropdownMenuItemProps = MenuItemProps & { id?: string };

export type DropdownMenuSeparatorProps = {
  type: "separator";
  id?: string;
};

export type DropdownMenuEntry = DropdownMenuItemProps | DropdownMenuSeparatorProps;

export type DropdownMenuProps = {
  trigger: React.ReactNode;
  items: DropdownMenuEntry[];
  disabled?: boolean;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
};

function isSeparator(item: DropdownMenuEntry): item is DropdownMenuSeparatorProps {
  return "type" in item && item.type === "separator";
}

export function DropdownMenu({
  trigger,
  items,
  disabled = false,
  align = "start",
  sideOffset = 8,
  contentClassName,
  contentStyle,
}: DropdownMenuProps) {
  if (disabled) return <>{trigger}</>;
  return (
    <RadixDropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={sideOffset}
        className={cn("dropdown-menu__content", contentClassName)}
        style={contentStyle}
      >
        {items.map((item, index) =>
          isSeparator(item) ? (
            <DropdownMenuSeparator key={item.id ?? `separator-${index}`} />
          ) : (
            <DropdownMenuItem
              key={item.id ?? `${index}-${String(item.label)}`}
              asChild
              disabled={item.disabled}
              className="dropdown-menu__item"
            >
              <MenuItem {...item} className={cn("dropdown-menu__menu-item", item.className)} />
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </RadixDropdownMenu>
  );
}
