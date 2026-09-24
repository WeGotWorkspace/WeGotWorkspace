import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { groupContactCardsBySection } from "@/contacts-core/src/contacts-display-utils";

/** Matches `.list-item` intrinsic block size (5.5rem). */
export const CONTACTS_LIST_CARD_ROW_PX = 88;
/** Matches `.list-sticky-header` padding and line. */
export const CONTACTS_LIST_HEADER_ROW_PX = 36;
/** Below this, render every row. Large books window to the scrollport. */
export const CONTACTS_LIST_WINDOW_AFTER = 80;
const OVERSCAN_PX = 480;

export type ContactsListWindowRow =
  | { kind: "header"; letter: string; key: string }
  | { kind: "card"; card: ContactCard; key: string };

export function flattenContactListRows(cards: ContactCard[]): ContactsListWindowRow[] {
  const rows: ContactsListWindowRow[] = [];
  for (const section of groupContactCardsBySection(cards)) {
    rows.push({ kind: "header", letter: section.letter, key: `section-${section.letter}` });
    for (const card of section.cards) {
      rows.push({ kind: "card", card, key: card.id });
    }
  }
  return rows;
}

export function contactListRowHeight(row: ContactsListWindowRow): number {
  return row.kind === "header" ? CONTACTS_LIST_HEADER_ROW_PX : CONTACTS_LIST_CARD_ROW_PX;
}

export function contactListRowOffset(rows: ContactsListWindowRow[], index: number): number {
  let offset = 0;
  const end = Math.min(index, rows.length);
  for (let i = 0; i < end; i += 1) {
    offset += contactListRowHeight(rows[i]!);
  }
  return offset;
}

export function contactsListWindowRange(
  rows: ContactsListWindowRow[],
  scrollTop: number,
  viewportHeight: number,
): { start: number; end: number; paddingTop: number; paddingBottom: number } {
  if (rows.length === 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  if (rows.length <= CONTACTS_LIST_WINDOW_AFTER) {
    return { start: 0, end: rows.length, paddingTop: 0, paddingBottom: 0 };
  }
  if (viewportHeight <= 0) {
    const end = Math.min(rows.length, 24);
    return {
      start: 0,
      end,
      paddingTop: 0,
      paddingBottom: contactListRowOffset(rows, rows.length) - contactListRowOffset(rows, end),
    };
  }

  const from = Math.max(0, scrollTop - OVERSCAN_PX);
  const to = scrollTop + viewportHeight + OVERSCAN_PX;
  let offset = 0;
  let start = 0;
  let end = rows.length;
  let startSet = false;
  for (let index = 0; index < rows.length; index += 1) {
    const height = contactListRowHeight(rows[index]!);
    const next = offset + height;
    if (!startSet && next >= from) {
      start = index;
      startSet = true;
    }
    if (offset > to) {
      end = index;
      break;
    }
    offset = next;
  }

  const paddingTop = contactListRowOffset(rows, start);
  const paddingBottom = contactListRowOffset(rows, rows.length) - contactListRowOffset(rows, end);
  return { start, end, paddingTop, paddingBottom };
}
