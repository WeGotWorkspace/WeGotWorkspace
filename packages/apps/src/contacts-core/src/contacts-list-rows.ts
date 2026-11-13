import type { ContactCard } from "@/lib/models/contacts-types";
import { groupContactCardsBySection } from "@/contacts-core/src/contacts-display-utils";
import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import type { ContactsAddressBookSelectBook } from "@/contacts-core/src/contacts-address-book-select";

/**
 * Row sizes, the estimate for the shared list window. They must match
 * `--contacts-list-card-row-size` / `--contacts-list-header-row-size` in
 * `contacts-workspace.css`. Convert to px with the live root font size; do not
 * assume 16px.
 */
export const CONTACTS_LIST_CARD_ROW_REM = 6.75;
export const CONTACTS_LIST_HEADER_ROW_REM = 2.25;
const DEFAULT_ROOT_FONT_SIZE_PX = 16;

/** One list row: a letter header or a card, in display order. */
export type ContactsListRowItem =
  | { kind: "header"; letter: string; key: string }
  | { kind: "card"; card: ContactCard; key: string };

export function flattenContactListRows(cards: ContactCard[]): ContactsListRowItem[] {
  const rows: ContactsListRowItem[] = [];
  for (const section of groupContactCardsBySection(cards)) {
    rows.push({ kind: "header", letter: section.letter, key: `section-${section.letter}` });
    for (const card of section.cards) {
      rows.push({ kind: "card", card, key: card.id });
    }
  }
  return rows;
}

/** Root `html` font size in px (browser default / accessibility setting). */
export function readContactsListRootFontSizePx(
  doc: Document | null | undefined = typeof document !== "undefined" ? document : null,
): number {
  if (!doc?.documentElement) return DEFAULT_ROOT_FONT_SIZE_PX;
  const parsed = parseFloat(getComputedStyle(doc.documentElement).fontSize);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROOT_FONT_SIZE_PX;
}

export function contactListRowHeight(
  row: ContactsListRowItem,
  rootFontSizePx: number = DEFAULT_ROOT_FONT_SIZE_PX,
): number {
  const rem = row.kind === "header" ? CONTACTS_LIST_HEADER_ROW_REM : CONTACTS_LIST_CARD_ROW_REM;
  return rem * rootFontSizePx;
}

/** The row's address book, when the books are known and the card sits in one. */
export function contactListBook(
  card: ContactCard,
  addressBooks?: readonly ContactsAddressBookSelectBook[],
): ContactsAddressBookSelectBook | undefined {
  const bookId = firstEnabledAddressBookId(card.addressBookIds);
  return bookId ? addressBooks?.find((candidate) => candidate.id === bookId) : undefined;
}
