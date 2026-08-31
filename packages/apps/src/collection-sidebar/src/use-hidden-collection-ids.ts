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
  /** Empty first paint is placeholder bootstrap — do not treat it as "user un-hid everything". */
  const hydratedFromItemsRef = useRef(items.length > 0);

  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => {
    const persisted = persist.read();
    if (items.length === 0) {
      return new Set(persisted?.hiddenIds ?? []);
    }
    return new Set(resolveHiddenCollectionIds(items, persisted));
  });

  useEffect(() => {
    // Offline-first apps mount with `[]` then hydrate. Writing that empty
    // snapshot would wipe last-session hidden ids from localStorage.
    if (itemsRef.current.length === 0) return;
    persistRef.current.write(hiddenIds, itemIdsOf(itemsRef.current));
  }, [hiddenIds]);

  useEffect(() => {
    if (items.length === 0) return;
    setHiddenIds((current) => {
      const persisted = persistRef.current.read();
      const prefs = hydratedFromItemsRef.current
        ? { hiddenIds: [...current], knownIds: [...seenIdsRef.current] }
        : persisted;
      const next = new Set(resolveHiddenCollectionIds(items, prefs));
      return sameHiddenIds(current, next) ? current : next;
    });
    seenIdsRef.current = new Set(itemIdsOf(items));
    hydratedFromItemsRef.current = true;
  }, [items]);

  return { hiddenIds, setHiddenIds };
}
