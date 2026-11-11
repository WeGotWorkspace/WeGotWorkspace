import {
  DropdownMenu as RadixDropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MenuItem, type MenuItemProps } from "@/menu-item/src/menu-item";
import { cn } from "@/lib/utils";
import "@/menu-dropdown/src/dropdown-menu.css";

export type DropdownMenuItemProps = MenuItemProps & { id?: string };

export type DropdownMenuSeparatorProps = {
  type: "separator";
  id?: string;
};

/** A row that swaps the menu to its own entries, with a back row on top (one level deep). */
export type DropdownMenuSubmenuProps = {
  type: "submenu";
  /** Required: the menu remembers which submenu is open by this id. */
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Short current value shown before the chevron, e.g. the chosen paper size. */
  hint?: React.ReactNode;
  disabled?: boolean;
  /** One level deep: a submenu holds items and separators, not another submenu. */
  items: DropdownMenuSubmenuEntry[];
  /** Class on the wrapper of the open submenu's rows. */
  contentClassName?: string;
};

export type DropdownMenuSubmenuEntry = DropdownMenuItemProps | DropdownMenuSeparatorProps;

export type DropdownMenuEntry = DropdownMenuSubmenuEntry | DropdownMenuSubmenuProps;

export type DropdownMenuProps = {
  trigger: React.ReactNode;
  items: DropdownMenuEntry[];
  disabled?: boolean;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  /**
   * When the menu closes focus goes back to the trigger. Call `preventDefault()` to
   * keep it where an item put it (e.g. on a field the item just added).
   */
  onCloseAutoFocus?: (event: Event) => void;
  /** The menu opened or closed (e.g. to keep clicks off what lies under it). */
  onOpenChange?: (open: boolean) => void;
};

function isSeparator(item: DropdownMenuEntry): item is DropdownMenuSeparatorProps {
  return "type" in item && item.type === "separator";
}

function isSubmenu(item: DropdownMenuEntry): item is DropdownMenuSubmenuProps {
  return "type" in item && item.type === "submenu";
}

/** `id` keys the entry; it must not land on the DOM row MenuItem renders. */
function menuItemProps({ id: _id, ...props }: DropdownMenuItemProps): MenuItemProps {
  return props;
}

export function DropdownMenu({
  trigger,
  items,
  disabled = false,
  align = "start",
  sideOffset = 8,
  contentClassName,
  contentStyle,
  onCloseAutoFocus,
  onOpenChange,
}: DropdownMenuProps) {
  // A submenu opens in place of the list (drill-down): a side flyout does not fit on phones.
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  // After "back", focus returns to the row that opened the submenu.
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  if (disabled) return <>{trigger}</>;
  const openSubmenu = items.find(
    (item): item is DropdownMenuSubmenuProps => isSubmenu(item) && item.id === openSubmenuId,
  );
  return (
    <RadixDropdownMenu
      onOpenChange={(open) => {
        onOpenChange?.(open);
        if (open) return;
        setOpenSubmenuId(null);
        setReturnFocusId(null);
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={sideOffset}
        className={cn("dropdown-menu__content", contentClassName)}
        style={contentStyle}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {openSubmenu ? (
          <DropdownMenuSubmenuList
            submenu={openSubmenu}
            onBack={() => {
              setReturnFocusId(openSubmenu.id);
              setOpenSubmenuId(null);
            }}
          />
        ) : (
          <DropdownMenuEntries
            items={items}
            focusSubmenuId={returnFocusId}
            onOpenSubmenu={setOpenSubmenuId}
          />
        )}
      </DropdownMenuContent>
    </RadixDropdownMenu>
  );
}

function DropdownMenuEntries({
  items,
  focusSubmenuId,
  onOpenSubmenu,
}: {
  items: DropdownMenuEntry[];
  focusSubmenuId?: string | null;
  onOpenSubmenu?: (id: string) => void;
}) {
  return items.map((item, index) => {
    if (isSeparator(item)) {
      return <DropdownMenuSeparator key={item.id ?? `separator-${index}`} />;
    }
    if (isSubmenu(item)) {
      const id = item.id;
      return (
        <DropdownMenuStayOpenRow
          key={id}
          label={item.label}
          icon={item.icon}
          disabled={item.disabled}
          badge={
            <span className="dropdown-menu__submenu-end">
              {item.hint ? <span className="dropdown-menu__submenu-hint">{item.hint}</span> : null}
              <ChevronRight className="dropdown-menu__submenu-chevron" aria-hidden />
            </span>
          }
          className="dropdown-menu__submenu-row"
          autoFocus={focusSubmenuId === id}
          onActivate={() => onOpenSubmenu?.(id)}
        />
      );
    }
    return (
      <DropdownMenuItem
        key={item.id ?? `${index}-${String(item.label)}`}
        asChild
        disabled={item.disabled}
        className="dropdown-menu__item"
      >
        <MenuItem
          {...menuItemProps(item)}
          className={cn("dropdown-menu__menu-item", item.className)}
        />
      </DropdownMenuItem>
    );
  });
}

/** The open submenu: a back row with its name, then its entries. */
function DropdownMenuSubmenuList({
  submenu,
  onBack,
}: {
  submenu: DropdownMenuSubmenuProps;
  onBack: () => void;
}) {
  return (
    <div className={cn("dropdown-menu__submenu", submenu.contentClassName)}>
      <DropdownMenuStayOpenRow
        label={submenu.label}
        icon={<ChevronLeft aria-hidden />}
        className="dropdown-menu__submenu-back"
        autoFocus
        onActivate={onBack}
      />
      <DropdownMenuSeparator />
      <DropdownMenuEntries items={submenu.items} />
    </div>
  );
}

/** A row that changes what the menu shows instead of choosing something (menu stays open). */
function DropdownMenuStayOpenRow({
  label,
  icon,
  badge,
  disabled,
  className,
  autoFocus,
  onActivate,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // The row that had focus is gone after the swap; keep keyboard focus inside the menu.
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <DropdownMenuItem
      asChild
      disabled={disabled}
      className="dropdown-menu__item"
      onSelect={(event) => {
        event.preventDefault();
        onActivate();
      }}
    >
      <MenuItem
        ref={ref as React.Ref<HTMLButtonElement>}
        label={label}
        icon={icon}
        badge={badge}
        disabled={disabled}
        onClick={() => {}}
        className={cn("dropdown-menu__menu-item", className)}
      />
    </DropdownMenuItem>
  );
}
