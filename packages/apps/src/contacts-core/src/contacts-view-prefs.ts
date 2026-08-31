import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

export const CONTACTS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.contacts.viewPrefs";

export type ContactsViewPrefs = {
  hiddenAddressBookIds?: string[];
  knownAddressBookIds?: string[];
};

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseStoredIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
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
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function persistHiddenAddressBookIds(
  ids: ReadonlySet<string>,
  bookIds: ReadonlyArray<string>,
): void {
  writeContactsViewPrefs({
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
