import { useCallback, useState } from "react";
import {
  nextListSort,
  readListSort,
  writeListSort,
  type ListSort,
  type ListSortDirection,
} from "@/lib/list-sort";

export type UseListSortArgs<K extends string> = {
  /** Columns that can sort, each with the direction of its first click. */
  columns: Readonly<Record<K, ListSortDirection>>;
  defaultSort: ListSort<K>;
  /** Remember the choice per list (omit for pickers and other short-lived lists). */
  storageKey?: string;
};

export function useListSort<K extends string>({
  columns,
  defaultSort,
  storageKey,
}: UseListSortArgs<K>) {
  const [sort, setSort] = useState<ListSort<K>>(() =>
    storageKey ? readListSort(storageKey, Object.keys(columns) as K[], defaultSort) : defaultSort,
  );

  const toggleSort = useCallback(
    (key: K) => {
      setSort((current) => {
        const next = nextListSort(current, key, columns[key]);
        if (storageKey) writeListSort(storageKey, next);
        return next;
      });
    },
    [columns, storageKey],
  );

  return { sort, toggleSort };
}
