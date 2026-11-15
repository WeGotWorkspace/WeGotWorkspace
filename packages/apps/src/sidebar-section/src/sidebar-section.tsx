import { useId, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem, type MenuItemProps } from "@/menu-item/src/menu-item";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import type { SidebarSectionToggleAll } from "@/sidebar-section/src/section-toggle-all";
import { cn } from "@/lib/utils";
import "@/ui/field-label-row.css";
import "@/sidebar-section/src/sidebar-section.css";

type SidebarSectionProps = {
  title?: string;
  onAdd?: () => void;
  addLabel?: string;
  items?: MenuItemProps[];
  children?: ReactNode;
  className?: string;
  /** Fold state; the list is not rendered while collapsed. Needs {@link onToggleCollapsed}. */
  collapsed?: boolean;
  /** Makes the title a button that folds the section (a chevron after it, like a dropdown). */
  onToggleCollapsed?: () => void;
  /** Under the heading, above the list (e.g. a filter input). Hidden while collapsed. */
  beforeList?: ReactNode;
  /** An "All" row first in the list: a neutral dot that shows or hides every row. */
  toggleAll?: SidebarSectionToggleAll;
};

function itemListKey(item: MenuItemProps, index: number): string {
  if (item.to) return item.to;
  if (typeof item.label === "string") return `${index}:${item.label}`;
  return `item-${index}`;
}

export function SidebarSection({
  title,
  onAdd,
  addLabel = "Add item",
  items,
  children,
  className,
  collapsed = false,
  onToggleCollapsed,
  beforeList,
  toggleAll,
}: SidebarSectionProps) {
  const titleId = useId();
  const listId = useId();
  const folded = Boolean(onToggleCollapsed) && collapsed;

  return (
    <section
      className={cn("sidebar-section", className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {title ? (
        <div className="sidebar-section__heading">
          <h4 id={titleId} className={cn("field-label-row__label", "sidebar-section__title")}>
            {onToggleCollapsed ? (
              <button
                type="button"
                className="sidebar-section__fold"
                aria-expanded={!folded}
                aria-controls={listId}
                onClick={onToggleCollapsed}
              >
                <span className="sidebar-section__title-text">{title}</span>
                <ChevronDown className="sidebar-section__chevron" aria-hidden />
              </button>
            ) : (
              title
            )}
          </h4>
          {onAdd ? (
            <IconButton
              label={addLabel}
              icon={<Plus className="size-3.5" aria-hidden />}
              size="xs"
              variant="outline"
              onClick={onAdd}
              className="sidebar-section__add"
            />
          ) : null}
        </div>
      ) : null}
      {folded ? null : beforeList}
      <ul className="sidebar-section__list" id={listId} hidden={folded}>
        {folded || !toggleAll ? null : (
          <CollectionSidebarRow
            className="sidebar-section__all"
            name={toggleAll.name ?? "All"}
            color="var(--workspace-foreground)"
            visible={toggleAll.checked}
            visibilityLabel={toggleAll.label}
            onToggleVisibility={toggleAll.onToggle}
            onSelect={toggleAll.onToggle}
          />
        )}
        {folded
          ? null
          : items
            ? items.map((item, index) => (
                <li key={itemListKey(item, index)}>
                  <MenuItem {...item} />
                </li>
              ))
            : children}
      </ul>
    </section>
  );
}
