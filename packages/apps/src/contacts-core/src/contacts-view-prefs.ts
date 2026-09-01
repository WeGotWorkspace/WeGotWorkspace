import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

export const CONTACTS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.contacts.viewPrefs";

const EMPTY_ADDRESS_BOOK_COLORS: Record<string, string> = {};

export type ContactsViewPrefs = {
  hiddenAddressBookIds?: string[];
  knownAddressBookIds?: string[];
  /** Device-local address-book color overrides. RFC 9610 has no `color`. */
  addressBookColors?: Record<string, string>;
};

const viewPrefsListeners = new Set<() => void>();
let colorOverridesRaw: string | null | undefined;
let colorOverridesSnapshot: Record<string, string> = EMPTY_ADDRESS_BOOK_COLORS;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitContactsViewPrefs(): void {
  for (const listener of viewPrefsListeners) listener();
}

export function isStoredAddressBookColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parseStoredIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parseStoredColorMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const colors: Record<string, string> = {};
  for (const [id, color] of Object.entries(value as Record<string, unknown>)) {
    if (id.trim() && isStoredAddressBookColor(color)) colors[id] = color;
  }
  return Object.keys(colors).length > 0 ? colors : undefined;
}

export function parseContactsViewPrefs(raw: string | null): ContactsViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const prefs: ContactsViewPrefs = {};
    const hiddenAddressBookIds = parseStoredIdList(record.hiddenAddressBookIds);
    if (hiddenAddressBookIds !== undefined) prefs.hiddenAddressBookIds = hiddenAddressBookIds;
    const knownAddressBookIds = parseStoredIdList(record.knownAddressBookIds);
    if (knownAddressBookIds !== undefined) prefs.knownAddressBookIds = knownAddressBookIds;
    const addressBookColors = parseStoredColorMap(record.addressBookColors);
    if (addressBookColors !== undefined) prefs.addressBookColors = addressBookColors;
    return Object.keys(prefs).length > 0 ? prefs : null;
  } catch {
    return null;
  }
}

export function readContactsViewPrefs(): ContactsViewPrefs | null {
  if (!hasWindowStorage()) return null;
  try {
    return parseContactsViewPrefs(window.localStorage.getItem(CONTACTS_VIEW_PREFS_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeContactsViewPrefs(prefs: ContactsViewPrefs): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(CONTACTS_VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    colorOverridesRaw = undefined;
    emitContactsViewPrefs();
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function subscribeContactsViewPrefs(listener: () => void): () => void {
  viewPrefsListeners.add(listener);
  return () => {
    viewPrefsListeners.delete(listener);
  };
}

export function getAddressBookColorOverrides(): Record<string, string> {
  if (!hasWindowStorage()) return EMPTY_ADDRESS_BOOK_COLORS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
  } catch {
    return EMPTY_ADDRESS_BOOK_COLORS;
  }
  if (raw === colorOverridesRaw) return colorOverridesSnapshot;
  colorOverridesRaw = raw;
  colorOverridesSnapshot =
    parseContactsViewPrefs(raw)?.addressBookColors ?? EMPTY_ADDRESS_BOOK_COLORS;
  return colorOverridesSnapshot;
}

export function patchContactsViewPrefs(partial: ContactsViewPrefs): ContactsViewPrefs {
  const current = readContactsViewPrefs() ?? {};
  const next: ContactsViewPrefs = { ...current };
  if (partial.hiddenAddressBookIds !== undefined) {
    next.hiddenAddressBookIds = partial.hiddenAddressBookIds;
  }
  if (partial.knownAddressBookIds !== undefined) {
    next.knownAddressBookIds = partial.knownAddressBookIds;
  }
  if (partial.addressBookColors !== undefined) {
    next.addressBookColors = partial.addressBookColors;
  }
  writeContactsViewPrefs(next);
  return next;
}

export function persistAddressBookColor(bookId: string, color: string): void {
  const id = bookId.trim();
  if (!id || !isStoredAddressBookColor(color)) return;
  const current = readContactsViewPrefs() ?? {};
  patchContactsViewPrefs({
    addressBookColors: {
      ...current.addressBookColors,
      [id]: color,
    },
  });
}

export function persistHiddenAddressBookIds(
  ids: ReadonlySet<string>,
  bookIds: ReadonlyArray<string>,
): void {
  patchContactsViewPrefs({
    hiddenAddressBookIds: [...ids],
    knownAddressBookIds: [...new Set(bookIds.filter((id) => id.length > 0))],
  });
}

export function resolveHiddenAddressBookIds(
  books: ReadonlyArray<{ id: string; isVisible?: boolean }>,
  persisted?: ContactsViewPrefs | null,
): string[] {
  return resolveHiddenCollectionIds(books, {
    hiddenIds: persisted?.hiddenAddressBookIds,
    knownIds: persisted?.knownAddressBookIds,
  });
}
