import { ArrowUpDown } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import type { ListSort, ListSortDirection } from "@/lib/list-sort";

/** One thing a list can be sorted by. The app names it and says how each direction reads. */
export type ListSortOption<K extends string> = {
  key: K;
  label: string;
  /** Ascending, as people say it: "A to Z", "Oldest first". */
  ascendingLabel: string;
  descendingLabel: string;
};

export type ListSortMenuLabels = {
  /** Accessible name of the trigger button. */
  menu: string;
  sortBy: string;
  order: string;
};

export type ListSortMenuProps<K extends string> = {
  options: readonly ListSortOption<K>[];
  sort: ListSort<K>;
  onChange: (sort: ListSort<K>) => void;
  labels: ListSortMenuLabels;
  /** Direction a key starts in when picked from the menu. */
  firstDirection: Readonly<Record<K, ListSortDirection>>;
  disabled?: boolean;
};

/**
 * Sort control for lists without column headers (Notes, and Drive / Docs / Tasks next):
 * one menu with the sort key and its direction. Apps only declare their options.
 */
export function ListSortMenu<K extends string>({
  options,
  sort,
  onChange,
  labels,
  firstDirection,
  disabled,
}: ListSortMenuProps<K>) {
  const current = options.find((option) => option.key === sort.key) ?? options[0];
  const items: DropdownMenuEntry[] = [
    { type: "heading", id: "sort-by", label: labels.sortBy },
    ...options.map((option) => ({
      id: `key-${option.key}`,
      label: option.label,
      checked: option.key === sort.key,
      onClick: () => {
        if (option.key !== sort.key) {
          onChange({ key: option.key, direction: firstDirection[option.key] });
        }
      },
    })),
    { type: "separator", id: "sort-sep" },
    { type: "heading", id: "sort-order", label: labels.order },
    ...(["asc", "desc"] as const).map((direction) => ({
      id: `direction-${direction}`,
      label: direction === "asc" ? current.ascendingLabel : current.descendingLabel,
      checked: sort.direction === direction,
      onClick: () => {
        if (sort.direction !== direction) onChange({ key: sort.key, direction });
      },
    })),
  ];

  return (
    <DropdownMenu
      align="end"
      disabled={disabled}
      items={items}
      trigger={
        <IconButton
          label={labels.menu}
          icon={<ArrowUpDown className="size-4" />}
          size="md"
          variant="outline"
        />
      }
    />
  );
}
