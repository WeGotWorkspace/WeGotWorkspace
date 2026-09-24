import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  CONTACTS_LIST_CARD_ROW_PX,
  CONTACTS_LIST_HEADER_ROW_PX,
  contactsListWindowRange,
  flattenContactListRows,
} from "./contacts-list-window";

function card(id: string, full: string): ContactCard {
  return {
    id,
    uid: id,
    name: { full },
  } as ContactCard;
}

describe("contactsListWindowRange", () => {
  it("renders a short list in full", () => {
    const rows = flattenContactListRows([card("a", "Ada"), card("b", "Bea")]);
    expect(contactsListWindowRange(rows, 0, 400)).toEqual({
      start: 0,
      end: rows.length,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("windows a large book to the scrollport plus overscan", () => {
    const cards = Array.from({ length: 120 }, (_, index) =>
      card(`c-${index}`, `Person ${String(index).padStart(3, "0")}`),
    );
    const rows = flattenContactListRows(cards);
    const range = contactsListWindowRange(rows, 0, 400);
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThan(rows.length);
    expect(range.paddingTop).toBe(0);
    expect(range.paddingBottom).toBeGreaterThan(0);

    const scrolled = contactsListWindowRange(rows, 4000, 400);
    expect(scrolled.start).toBeGreaterThan(0);
    expect(scrolled.paddingTop).toBeGreaterThan(0);
    const visibleHeights =
      (scrolled.end - scrolled.start) * CONTACTS_LIST_CARD_ROW_PX + CONTACTS_LIST_HEADER_ROW_PX;
    expect(visibleHeights).toBeGreaterThan(400);
  });
});
