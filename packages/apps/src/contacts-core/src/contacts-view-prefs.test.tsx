import { afterEach, describe, expect, it } from "vitest";
import { addressBookDotColor } from "./contacts-addressbook-color";
import {
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  contactsHiddenAddressBooks,
  contactsViewPrefs,
  getAddressBookColorOverrides,
  persistAddressBookColor,
} from "./contacts-view-prefs";

/** Written by the pre-#1636 store (hidden books, a colour, folded groups). */
const OLD_FORMAT =
  '{"hiddenAddressBookIds":["work"],"knownAddressBookIds":["default","work"],' +
  '"addressBookColors":{"default":"#ec4899"},"collapsedAddressBookIds":["default"]}';

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
    expect(getAddressBookColorOverrides()).toEqual({ default: "#ec4899" });
  });

  it("drops invalid colours and empty ids", () => {
    expect(
      contactsViewPrefs.parse(
        JSON.stringify({
          addressBookColors: { default: "#ec4899", work: "red", "": "#22c55e" },
          collapsedAddressBookIds: ["default", ""],
        }),
      ),
    ).toEqual({ addressBookColors: { default: "#ec4899" }, collapsedAddressBookIds: ["default"] });
  });

  it("keeps hidden books and folded groups when a colour is written", () => {
    window.localStorage.setItem("wgw.ui.contacts.viewPrefs", OLD_FORMAT);
    persistAddressBookColor("work", "#22c55e");
    persistAddressBookColor("work", "red");
    expect(window.localStorage.getItem("wgw.ui.contacts.viewPrefs")).toBe(
      OLD_FORMAT.replace('"#ec4899"}', '"#ec4899","work":"#22c55e"}'),
    );
    expect(addressBookDotColor({ id: "work" })).toBe("#22c55e");
  });

  it("keeps colours when hidden books are written later", () => {
    persistAddressBookColor("default", "#22c55e");
    contactsHiddenAddressBooks.write(new Set(["work"]), ["default", "work"]);
    expect(contactsViewPrefs.read()?.addressBookColors).toEqual({ default: "#22c55e" });
    expect(addressBookDotColor({ id: "default" })).toBe("#22c55e");
  });
});
