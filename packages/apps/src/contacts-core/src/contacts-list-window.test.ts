import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  CONTACTS_LIST_CARD_ROW_REM,
  CONTACTS_LIST_HEADER_ROW_REM,
  contactListRowHeight,
  contactListWindowSlice,
  contactsListWindowRange,
  flattenContactListRows,
  readContactsListRootFontSizePx,
} from "./contacts-list-window";

function card(id: string, full: string): ContactCard {
  return {
    id,
    uid: id,
    name: { full },
  } as ContactCard;
}

function named(id: string, given: string, surname: string): ContactCard {
  return {
    id,
    uid: id,
    name: {
      full: `${given} ${surname}`,
      components: [
        { kind: "given", value: given },
        { kind: "surname", value: surname },
      ],
    },
  } as ContactCard;
}

describe("contactsListWindowRange", () => {
  it("renders a short list in full", () => {
    const rows = flattenContactListRows([card("a", "Ada"), card("b", "Bea")]);
    expect(contactsListWindowRange(rows, 0, 400, 16)).toEqual({
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
    const range = contactsListWindowRange(rows, 0, 400, 16);
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThan(rows.length);
    expect(range.paddingTop).toBe(0);
    expect(range.paddingBottom).toBeGreaterThan(0);

    const scrolled = contactsListWindowRange(rows, 4000, 400, 16);
    expect(scrolled.start).toBeGreaterThan(0);
    expect(scrolled.paddingTop).toBeGreaterThan(0);
    const cardPx = CONTACTS_LIST_CARD_ROW_REM * 16;
    const headerPx = CONTACTS_LIST_HEADER_ROW_REM * 16;
    const visibleHeights = (scrolled.end - scrolled.start) * cardPx + headerPx;
    expect(visibleHeights).toBeGreaterThan(400);
  });

  it("scales row offsets with the live root font size", () => {
    const rows = flattenContactListRows([
      named("a-1", "Ada", "Aaron"),
      named("a-2", "Bea", "Aaron"),
    ]);
    const at16 = contactListRowHeight(rows[1]!, 16);
    const at20 = contactListRowHeight(rows[1]!, 20);
    expect(at16).toBe(CONTACTS_LIST_CARD_ROW_REM * 16);
    expect(at20).toBe(CONTACTS_LIST_CARD_ROW_REM * 20);
    expect(at20).toBeGreaterThan(at16);

    const range16 = contactsListWindowRange(
      flattenContactListRows(
        Array.from({ length: 120 }, (_, index) =>
          card(`c-${index}`, `Person ${String(index).padStart(3, "0")}`),
        ),
      ),
      2000,
      400,
      16,
    );
    const range20 = contactsListWindowRange(
      flattenContactListRows(
        Array.from({ length: 120 }, (_, index) =>
          card(`c-${index}`, `Person ${String(index).padStart(3, "0")}`),
        ),
      ),
      2000,
      400,
      20,
    );
    expect(range20.start).toBeLessThan(range16.start);
  });

  it("keeps the preceding letter header when the window starts mid-section", () => {
    const cards = [
      ...Array.from({ length: 90 }, (_, index) => named(`a-${index}`, `Ada ${index}`, "Aaron")),
      ...Array.from({ length: 20 }, (_, index) => named(`z-${index}`, `Zoe ${index}`, "Zimmerman")),
    ];
    const rows = flattenContactListRows(cards);
    const range = contactsListWindowRange(rows, 2000, 400, 16);
    expect(rows[range.start]?.kind).toBe("card");

    const slice = contactListWindowSlice(rows, range, 16);
    expect(slice.rows[0]).toMatchObject({ kind: "header", letter: "A" });
    expect(slice.paddingTop).toBe(range.paddingTop - CONTACTS_LIST_HEADER_ROW_REM * 16);
    expect(slice.rows.filter((row) => row.kind === "header" && row.letter === "A")).toHaveLength(1);

    const top = contactsListWindowRange(rows, 0, 400, 16);
    const topSlice = contactListWindowSlice(rows, top, 16);
    expect(topSlice.rows[0]).toMatchObject({ kind: "header", letter: "A" });
    expect(topSlice.paddingTop).toBe(0);
    expect(topSlice.rows.filter((row) => row.kind === "header" && row.letter === "A")).toHaveLength(
      1,
    );
  });
});

describe("readContactsListRootFontSizePx", () => {
  it("falls back to 16 when the document is missing", () => {
    expect(readContactsListRootFontSizePx(null)).toBe(16);
  });
});
