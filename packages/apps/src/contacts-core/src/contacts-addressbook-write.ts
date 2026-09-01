import type { AddressBook, ContactsAPIOperations } from "@/contacts-core/src/contacts-types";
import type { CollectionShareWith } from "@/share-ui/collection-share";

/** Server-set names; the owned personal book is always Personal. */
export function contactsAddressBookDisplayName(
  book: Pick<AddressBook, "id" | "name"> & Partial<Pick<AddressBook, "isSharee" | "isDefault">>,
  personalLabel = "Personal",
): string {
  if (book.isSharee === true) return book.name;
  if (book.id === "default" || book.isDefault === true) return personalLabel;
  return book.name;
}

export type ContactsAddressBookOperations = Pick<ContactsAPIOperations, "patchAddressBook">;

/** Live AddressBook row — ids are `default` / `group-{slug}` / `shared-{n}`. */
export type ContactsAddressBookRow = AddressBook;

export type ContactsAddressBookDialogState = null | {
  bookId: string;
  name: string;
  mayShare: boolean;
  isSharee: boolean;
  shareWith: CollectionShareWith | null;
};

export function contactsBookViewKey(bookId: string): string {
  return `book:${bookId}`;
}

export function isSharedAddressBook(book?: ContactsAddressBookRow): boolean {
  return book?.isSharee === true;
}

/** Names are server-set; the personal book is always Personal. */
export function canRenameAddressBook(_book?: ContactsAddressBookRow): boolean {
  return false;
}

/** One provisioned book per principal — never owner-delete. */
export function canDeleteAddressBook(_book?: ContactsAddressBookRow): boolean {
  return false;
}

export function canShareAddressBook(book?: ContactsAddressBookRow): boolean {
  return book?.myRights?.mayShare === true;
}

/**
 * Sharee hide is per-user dismiss (`isSubscribed: false` / `mayDelete` on a
 * sharee instance), not owner destroy.
 */
export function canHideSharedAddressBook(book?: ContactsAddressBookRow): boolean {
  if (!isSharedAddressBook(book)) return false;
  return book?.myRights?.mayDelete !== false;
}

/** Pencil when the user can set shares or dismiss an inbound share. */
export function canOpenAddressBookSettings(book?: ContactsAddressBookRow): boolean {
  return canShareAddressBook(book) || canHideSharedAddressBook(book);
}

export function isViewOnlyAddressBook(book?: ContactsAddressBookRow): boolean {
  return book?.myRights?.mayWrite === false;
}

/**
 * Personal `default` and writable `group-{slug}` team books — not inbound
 * `shared-*` sharees (even if mayWrite). Same destinations for create-group
 * and vCard import.
 */
export function canWriteOwnedAddressBook(book?: ContactsAddressBookRow): boolean {
  if (!book || isSharedAddressBook(book) || isViewOnlyAddressBook(book)) return false;
  return book.id === "default" || book.isDefault === true || book.id.startsWith("group-");
}

/** Same gate as {@link canWriteOwnedAddressBook} — create-group destination. */
export function canCreateGroupInAddressBook(book?: ContactsAddressBookRow): boolean {
  return canWriteOwnedAddressBook(book);
}

export function writableOwnedAddressBooks(
  books: readonly ContactsAddressBookRow[],
): ContactsAddressBookRow[] {
  return books.filter((book) => canWriteOwnedAddressBook(book));
}

/** Same list as {@link writableOwnedAddressBooks} — create-group destinations. */
export function writableGroupAddressBooks(
  books: readonly ContactsAddressBookRow[],
): ContactsAddressBookRow[] {
  return writableOwnedAddressBooks(books);
}

/** Current view's book if writable, else personal `default`. */
export function defaultWritableAddressBookId(
  view: string,
  books: readonly ContactsAddressBookRow[],
): string | undefined {
  const writable = writableOwnedAddressBooks(books);
  if (writable.length === 0) return undefined;
  if (view.startsWith("book:")) {
    const bookId = view.slice("book:".length);
    if (writable.some((book) => book.id === bookId)) return bookId;
  }
  return writable.find((book) => book.isDefault || book.id === "default")?.id ?? writable[0]?.id;
}

/** Same default as {@link defaultWritableAddressBookId} — create-group picker. */
export function defaultCreateGroupAddressBookId(
  view: string,
  books: readonly ContactsAddressBookRow[],
): string | undefined {
  return defaultWritableAddressBookId(view, books);
}

export function addressBookPatchOp(
  operations?: ContactsAddressBookOperations | null,
): ContactsAddressBookOperations["patchAddressBook"] {
  return operations?.patchAddressBook;
}

export function addressBookDialogFromRow(
  book: ContactsAddressBookRow,
  personalLabel = "Personal",
): Exclude<ContactsAddressBookDialogState, null> {
  return {
    bookId: book.id,
    name: contactsAddressBookDisplayName(book, personalLabel),
    mayShare: canShareAddressBook(book),
    isSharee: isSharedAddressBook(book),
    shareWith: book.shareWith ?? null,
  };
}
