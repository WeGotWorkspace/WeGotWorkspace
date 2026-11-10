import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem, type MenuItemProps } from "@/menu-item/src/menu-item";
import { VisibilityDot } from "@/collection-sidebar/src/visibility-dot";
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
  /** Shows a fold toggle in the heading. */
  onToggleCollapsed?: () => void;
  collapseLabel?: string;
  expandLabel?: string;
  /** Under the heading, above the list (e.g. a filter input). Hidden while collapsed. */
  beforeList?: ReactNode;
  /** Shows a neutral show/hide-all dot before the title. */
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
  collapseLabel,
  expandLabel,
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
        <div
          className={cn(
            "sidebar-section__heading",
            toggleAll && "sidebar-section__heading--toggle-all",
          )}
        >
          {toggleAll ? (
            <VisibilityDot
              checked={toggleAll.checked}
              label={toggleAll.label}
              onToggle={toggleAll.onToggle}
              className="sidebar-section__toggle-all"
            />
          ) : null}
          <h4 id={titleId} className={cn("field-label-row__label", "sidebar-section__title")}>
            {title}
          </h4>
          {onToggleCollapsed ? (
            <IconButton
              label={
                folded ? (expandLabel ?? `Expand ${title}`) : (collapseLabel ?? `Collapse ${title}`)
              }
              icon={
                folded ? (
                  <ChevronRight className="size-3.5" aria-hidden />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden />
                )
              }
              size="xs"
              variant="ghost"
              aria-expanded={!folded}
              aria-controls={listId}
              onClick={onToggleCollapsed}
              className="sidebar-section__fold"
            />
          ) : null}
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
