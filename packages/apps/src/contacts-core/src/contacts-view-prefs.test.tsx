import { afterEach, describe, expect, it } from "vitest";
import { addressBookDotColor } from "./contacts-addressbook-color";
import {
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  parseContactsViewPrefs,
  persistAddressBookColor,
  persistHiddenAddressBookIds,
  readContactsViewPrefs,
} from "./contacts-view-prefs";

function clearStorage() {
  window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
}

describe("parseContactsViewPrefs", () => {
  it("reads address-book color overrides and ignores invalid hex", () => {
    expect(
      parseContactsViewPrefs(
        JSON.stringify({
          addressBookColors: { default: "#ec4899", work: "red", "": "#22c55e" },
        }),
      ),
    ).toEqual({ addressBookColors: { default: "#ec4899" } });
  });
});

describe("persistAddressBookColor", () => {
  afterEach(() => {
    clearStorage();
  });

  it("writes a color without wiping hidden-book prefs", () => {
    persistHiddenAddressBookIds(new Set(["work"]), ["default", "work"]);
    persistAddressBookColor("default", "#ec4899");
    expect(readContactsViewPrefs()).toEqual({
      hiddenAddressBookIds: ["work"],
      knownAddressBookIds: ["default", "work"],
      addressBookColors: { default: "#ec4899" },
    });
    expect(addressBookDotColor({ id: "default" })).toBe("#ec4899");
  });

  it("keeps colors when hidden ids are written later", () => {
    persistAddressBookColor("default", "#22c55e");
    persistHiddenAddressBookIds(new Set(["work"]), ["default", "work"]);
    expect(readContactsViewPrefs()?.addressBookColors).toEqual({ default: "#22c55e" });
    expect(addressBookDotColor({ id: "default" })).toBe("#22c55e");
  });
});
