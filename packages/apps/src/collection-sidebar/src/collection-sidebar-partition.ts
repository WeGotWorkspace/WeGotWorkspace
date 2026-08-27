export type CollectionSidebarPartitionOptions<T> = {
  /** Inbound ACL sharee. Defaults to `item.isSharee === true`. */
  isSharee?: (item: T) => boolean;
  /** Calendar-only ICS subscription. Omitted for Tasks. */
  isSubscription?: (item: T) => boolean;
};

function itemIsSharee<T>(item: T, isSharee?: (item: T) => boolean): boolean {
  if (isSharee) return isSharee(item);
  return Boolean((item as { isSharee?: boolean }).isSharee);
}

/** Shared with me = inbound ACL (`isSharee`), minus an optional subscription predicate. */
export function isSharedWithMeCollection<T>(
  item: T,
  options?: CollectionSidebarPartitionOptions<T>,
): boolean {
  if (!itemIsSharee(item, options?.isSharee)) return false;
  if (options?.isSubscription?.(item)) return false;
  return true;
}

export function sortCollectionsByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export function partitionOwnedAndShared<T extends { name: string }>(
  items: readonly T[],
  options?: CollectionSidebarPartitionOptions<T>,
): { owned: T[]; shared: T[] } {
  const owned: T[] = [];
  const shared: T[] = [];
  for (const item of items) {
    if (isSharedWithMeCollection(item, options)) shared.push(item);
    else owned.push(item);
  }
  return {
    owned: sortCollectionsByName(owned),
    shared: sortCollectionsByName(shared),
  };
}
