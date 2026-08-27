export type HiddenCollectionPrefs = {
  hiddenIds?: string[];
  knownIds?: string[];
};

export function sameHiddenIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...right].every((id) => left.has(id));
}

/**
 * Hidden ids are the source of truth once this device has seen a collection.
 * Server `isVisible: false` only seeds collections that have never appeared in a
 * persisted snapshot (`knownIds`). Legacy payloads without that list treat the
 * current set as already seen so an explicit un-hide sticks.
 */
export function resolveHiddenCollectionIds(
  items: ReadonlyArray<{ id: string; isVisible?: boolean }>,
  persisted?: HiddenCollectionPrefs | null,
): string[] {
  const currentIds = new Set(items.map((item) => item.id));
  const fromServer = items.filter((item) => item.isVisible === false).map((item) => item.id);
  if (!persisted || persisted.hiddenIds === undefined) return fromServer;

  const seen = new Set(persisted.knownIds ?? currentIds);
  const fromUser = persisted.hiddenIds.filter((id) => currentIds.has(id));
  const fromNewServerHidden = fromServer.filter((id) => !seen.has(id));
  return [...new Set([...fromUser, ...fromNewServerHidden])];
}
