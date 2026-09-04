import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

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

const viewPrefsListeners = new Set<() => void>();
let colorOverridesRaw: string | null | undefined;
let colorOverridesSnapshot: Record<string, string> = EMPTY_ADDRESS_BOOK_COLORS;
const EMPTY_COLLAPSED_IDS: readonly string[] = [];
let collapsedIdsRaw: string | null | undefined;
let collapsedIdsSnapshot: readonly string[] = EMPTY_COLLAPSED_IDS;

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
    const collapsedAddressBookIds = parseStoredIdList(record.collapsedAddressBookIds);
    if (collapsedAddressBookIds !== undefined) {
      prefs.collapsedAddressBookIds = collapsedAddressBookIds;
    }
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
    collapsedIdsRaw = undefined;
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
  if (partial.collapsedAddressBookIds !== undefined) {
    next.collapsedAddressBookIds = partial.collapsedAddressBookIds;
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

export function getCollapsedAddressBookIds(): readonly string[] {
  if (!hasWindowStorage()) return EMPTY_COLLAPSED_IDS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
  } catch {
    return EMPTY_COLLAPSED_IDS;
  }
  if (raw === collapsedIdsRaw) return collapsedIdsSnapshot;
  collapsedIdsRaw = raw;
  collapsedIdsSnapshot =
    parseContactsViewPrefs(raw)?.collapsedAddressBookIds ?? EMPTY_COLLAPSED_IDS;
  return collapsedIdsSnapshot;
}

export function persistCollapsedAddressBookIds(ids: ReadonlySet<string>): void {
  patchContactsViewPrefs({
    collapsedAddressBookIds: [...ids],
  });
}

export function toggleCollapsedAddressBookId(bookId: string): void {
  const id = bookId.trim();
  if (!id) return;
  const next = new Set(readContactsViewPrefs()?.collapsedAddressBookIds ?? []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  persistCollapsedAddressBookIds(next);
}

export function expandCollapsedAddressBookId(bookId: string): void {
  const id = bookId.trim();
  if (!id) return;
  const current = readContactsViewPrefs()?.collapsedAddressBookIds ?? [];
  if (!current.includes(id)) return;
  persistCollapsedAddressBookIds(new Set(current.filter((item) => item !== id)));
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
