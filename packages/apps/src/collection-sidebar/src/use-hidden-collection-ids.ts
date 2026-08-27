import { useEffect, useRef, useState } from "react";
import {
  resolveHiddenCollectionIds,
  sameHiddenIds,
  type HiddenCollectionPrefs,
} from "@/collection-sidebar/src/collection-hidden-ids";

function itemIdsOf(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

export type UseHiddenCollectionIdsPersist = {
  read: () => HiddenCollectionPrefs | null;
  write: (hiddenIds: ReadonlySet<string>, itemIds: ReadonlyArray<string>) => void;
};

/** Device-local hidden-collection set. Persist lives here so controllers stay orchestrators. */
export function useHiddenCollectionIds<T extends { id: string; isVisible?: boolean }>(
  items: ReadonlyArray<T>,
  persist: UseHiddenCollectionIdsPersist,
) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const seenIdsRef = useRef<ReadonlySet<string>>(
    new Set(persist.read()?.knownIds ?? itemIdsOf(items)),
  );

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => {
    return new Set(resolveHiddenCollectionIds(items, persist.read()));
  });

  useEffect(() => {
    persistRef.current.write(hiddenIds, itemIdsOf(itemsRef.current));
  }, [hiddenIds]);

  useEffect(() => {
    setHiddenIds((current) => {
      const next = new Set(
        resolveHiddenCollectionIds(items, {
          hiddenIds: [...current],
          knownIds: [...seenIdsRef.current],
        }),
      );
      return sameHiddenIds(current, next) ? current : next;
    });
    seenIdsRef.current = new Set(itemIdsOf(items));
  }, [items]);

  return { hiddenIds, setHiddenIds };
}
