import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

export const CONTACTS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.contacts.viewPrefs";

const EMPTY_ADDRESS_BOOK_COLORS: Record<string, string> = {};

export type ContactsViewPrefs = {
  hiddenAddressBookIds?: string[];
  knownAddressBookIds?: string[];
  /** Device-local address-book color overrides. RFC 9610 has no `color`. */
  addressBookColors?: Record<string, string>;
  /** Books whose sidebar groups are folded. Missing / empty = all expanded. */
  collapsedAddressBookIds?: string[];
};

export function isStoredAddressBookColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parseStoredColorMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const colors: Record<string, string> = {};
  for (const [id, color] of Object.entries(value as Record<string, unknown>)) {
    if (id.trim() && isStoredAddressBookColor(color)) colors[id] = color;
  }
  return Object.keys(colors).length > 0 ? colors : undefined;
}

export const contactsViewPrefs = createViewPrefsStore<ContactsViewPrefs>(
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  {
    hiddenAddressBookIds: viewPrefsField.idList,
    knownAddressBookIds: viewPrefsField.idList,
    addressBookColors: parseStoredColorMap,
    collapsedAddressBookIds: viewPrefsField.idList,
  },
);

export const contactsHiddenAddressBooks = contactsViewPrefs.hiddenCollection(
  "hiddenAddressBookIds",
  "knownAddressBookIds",
);

/** Same object until the stored prefs change (`useSyncExternalStore` getter). */
export const getAddressBookColorOverrides = contactsViewPrefs.snapshot(
  (prefs) => prefs?.addressBookColors ?? EMPTY_ADDRESS_BOOK_COLORS,
);

export function persistAddressBookColor(bookId: string, color: string): void {
  const id = bookId.trim();
  if (!id || !isStoredAddressBookColor(color)) return;
  const current = contactsViewPrefs.read()?.addressBookColors;
  contactsViewPrefs.patch({ addressBookColors: { ...current, [id]: color } });
}
