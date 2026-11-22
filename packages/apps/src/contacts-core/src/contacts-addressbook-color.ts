/** Enabled `addressBookIds` keys on a JSContact card (exact ids, not prefix). */
export function enabledAddressBookIds(addressBookIds?: Record<string, unknown> | null): string[] {
  if (!addressBookIds) return [];
  const ids: string[] = [];
  for (const [id, enabled] of Object.entries(addressBookIds)) {
    if (enabled && id.trim()) ids.push(id);
  }
  return ids;
}

/** First enabled `addressBookIds` key on a JSContact card (groups live in one book). */
export function firstEnabledAddressBookId(
  addressBookIds?: Record<string, unknown> | null,
): string | undefined {
  return enabledAddressBookIds(addressBookIds)[0];
}
