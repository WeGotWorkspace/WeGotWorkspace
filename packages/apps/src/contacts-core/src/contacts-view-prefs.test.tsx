import { afterEach, describe, expect, it } from "vitest";
import {
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  contactsHiddenAddressBooks,
  contactsViewPrefs,
} from "./contacts-view-prefs";

/** Written by the pre-#1636 store (hidden books, folded groups). */
const OLD_FORMAT =
  '{"hiddenAddressBookIds":["work"],"knownAddressBookIds":["default","work"],' +
  '"collapsedAddressBookIds":["default"]}';

describe("contactsViewPrefs binding", () => {
  afterEach(() => {
    window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
  });

  it("reads every field written by the old store", () => {
    window.localStorage.setItem("wgw.ui.contacts.viewPrefs", OLD_FORMAT);
    expect(contactsViewPrefs.read()).toEqual(JSON.parse(OLD_FORMAT));
    expect(contactsHiddenAddressBooks.read()).toEqual({
      hiddenIds: ["work"],
      knownIds: ["default", "work"],
    });
  });

  it("drops empty ids", () => {
    expect(
      contactsViewPrefs.parse(JSON.stringify({ collapsedAddressBookIds: ["default", ""] })),
    ).toEqual({ collapsedAddressBookIds: ["default"] });
  });

  it("forgets a colour an older build stored", () => {
    expect(contactsViewPrefs.parse('{"addressBookColors":{"default":"#ec4899"}}')).toBeNull();
  });
});
