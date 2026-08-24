import { useId, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem, type MenuItemProps } from "@/menu-item/src/menu-item";
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
}: SidebarSectionProps) {
  const titleId = useId();

  return (
    <section
      className={cn("sidebar-section", className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {title ? (
        <div className="sidebar-section__heading">
          <h3 id={titleId} className={cn("field-label-row__label", "sidebar-section__title")}>
            {title}
          </h3>
          {onAdd ? (
            <IconButton
              label={addLabel}
              icon={<Plus className="size-3.5" aria-hidden />}
              size="sm"
              variant="subtle"
              onClick={onAdd}
              className="sidebar-section__add"
            />
          ) : null}
        </div>
      ) : null}
      <ul className="sidebar-section__list">
        {items
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
