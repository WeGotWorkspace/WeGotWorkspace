/**
 * Column sort for list views (suite list norm). One click sorts a column in its
 * natural direction (text A→Z, dates and sizes newest/largest first); a second
 * click on the same column flips it.
 */
export type ListSortDirection = "asc" | "desc";

export type ListSort<K extends string = string> = {
  key: K;
  direction: ListSortDirection;
};

export function nextListSort<K extends string>(
  current: ListSort<K>,
  key: K,
  firstDirection: ListSortDirection,
): ListSort<K> {
  if (current.key !== key) return { key, direction: firstDirection };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** `aria-sort` for a column header: only the sorted column says how. */
export function listSortAria<K extends string>(
  sort: ListSort<K>,
  key: K,
): "ascending" | "descending" | undefined {
  if (sort.key !== key) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Compare names the way people read them (case-insensitive, "file 2" before "file 10"). */
export function compareListText(a: string, b: string): number {
  return textCollator.compare(a, b);
}

/** Compare numbers; missing values sort last whatever the direction. */
export function compareListNumber(
  a: number | undefined,
  b: number | undefined,
  direction: ListSortDirection,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return direction === "asc" ? a - b : b - a;
}

export function readListSort<K extends string>(
  storageKey: string,
  keys: readonly K[],
  fallback: ListSort<K>,
): ListSort<K> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ListSort<K>>;
    if (
      parsed &&
      keys.includes(parsed.key as K) &&
      (parsed.direction === "asc" || parsed.direction === "desc")
    ) {
      return { key: parsed.key as K, direction: parsed.direction };
    }
  } catch {
    // Storage blocked or bad JSON: use the default order.
  }
  return fallback;
}

export function writeListSort(storageKey: string, sort: ListSort): void {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(sort));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
