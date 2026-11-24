import {
  getAddressBookColorOverrides,
  isStoredAddressBookColor,
} from "@/contacts-core/src/contacts-view-prefs";

/**
 * Sidebar collection swatches. RFC 9610 AddressBook has no `color` — this is a
 * client-only hash onto the same palette Tasks uses (`TASK_LIST_DOT_COLORS`).
 * Device-local overrides live in `wgw.ui.contacts.viewPrefs` (`addressBookColors`).
 * Not a vendor JMAP field.
 */
export const ADDRESS_BOOK_DOT_COLORS = [
  "#ea8c72",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#3b82f6",
] as const;

function hashAddressBookColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return (
    ADDRESS_BOOK_DOT_COLORS[hash % ADDRESS_BOOK_DOT_COLORS.length] ?? ADDRESS_BOOK_DOT_COLORS[0]
  );
}

export function addressBookDotColor(
  book: { id: string },
  overrides?: Record<string, string> | null,
): string {
  const override = (overrides ?? getAddressBookColorOverrides())[book.id];
  if (isStoredAddressBookColor(override)) return override;
  return hashAddressBookColor(book.id);
}

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

/**
 * Client color of the group's address book. Reuses {@link addressBookDotColor}
 * — no second hash. `undefined` when the book cannot be resolved (muted fallback).
 */
export function groupAddressBookColor(
  source: string | { addressBookIds?: Record<string, unknown> | null } | null | undefined,
  overrides?: Record<string, string> | null,
): string | undefined {
  const bookId =
    typeof source === "string"
      ? source.trim() || undefined
      : firstEnabledAddressBookId(source?.addressBookIds);
  if (!bookId) return undefined;
  return addressBookDotColor({ id: bookId }, overrides);
}
