import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import {
  CONTACTS_LIST_CARD_ROW_REM,
  CONTACTS_LIST_HEADER_ROW_REM,
  contactListRowHeight,
  flattenContactListRows,
  readContactsListRootFontSizePx,
} from "./contacts-list-rows";

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

describe("flattenContactListRows", () => {
  it("puts a letter header before each section's cards", () => {
    const rows = flattenContactListRows([
      named("a1", "Ann", "Adams"),
      named("b1", "Bob", "Brown"),
      named("a2", "Amy", "Allen"),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["section-A", "a1", "a2", "section-B", "b1"]);
    expect(rows[0]).toMatchObject({ kind: "header", letter: "A" });
  });
});

describe("contactListRowHeight", () => {
  it("scales the rem sizes with the live root font size", () => {
    const [header, card] = flattenContactListRows([named("a1", "Ann", "Adams")]);
    expect(contactListRowHeight(header!, 20)).toBe(CONTACTS_LIST_HEADER_ROW_REM * 20);
    expect(contactListRowHeight(card!, 20)).toBe(CONTACTS_LIST_CARD_ROW_REM * 20);
  });
});

describe("readContactsListRootFontSizePx", () => {
  it("falls back to 16 when the document is missing", () => {
    expect(readContactsListRootFontSizePx(null)).toBe(16);
  });
});
