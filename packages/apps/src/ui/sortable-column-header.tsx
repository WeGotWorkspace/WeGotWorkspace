import { ArrowDown, ArrowUp } from "lucide-react";
import type { ListSort, ListSortDirection } from "@/lib/list-sort";
import { cn } from "@/lib/utils";
import "@/ui/sortable-column-header.css";

export type SortableColumnHeaderProps<K extends string> = {
  label: string;
  sortKey: K;
  sort: ListSort<K>;
  onSort: (key: K) => void;
  /** Direction a first click gives; the hover hint shows it. */
  firstDirection?: ListSortDirection;
  /** Right-aligned columns put the arrow before the label. */
  align?: "start" | "end";
  className?: string;
};

/**
 * Column header label that sorts its list (suite list norm). Put it inside the
 * `th` and give the `th` `aria-sort={listSortAria(sort, key)}`.
 */
export function SortableColumnHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  firstDirection = "asc",
  align = "start",
  className,
}: SortableColumnHeaderProps<K>) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : firstDirection;
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={cn(
        "sortable-column-header",
        align === "end" && "sortable-column-header--end",
        className,
      )}
      data-active={active ? "" : undefined}
      onClick={() => onSort(sortKey)}
    >
      <span className="sortable-column-header__label">{label}</span>
      <Arrow className="sortable-column-header__arrow" aria-hidden />
    </button>
  );
}
