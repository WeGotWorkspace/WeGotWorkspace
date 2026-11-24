import { describe, expect, it } from "vitest";
import {
  ADDRESS_BOOK_DOT_COLORS,
  addressBookDotColor,
  enabledAddressBookIds,
  firstEnabledAddressBookId,
  groupAddressBookColor,
} from "./contacts-addressbook-color";

describe("addressBookDotColor", () => {
  it("is stable per book id and stays in the shared Tasks palette", () => {
    expect(addressBookDotColor({ id: "default" })).toBe(addressBookDotColor({ id: "default" }));
    expect(ADDRESS_BOOK_DOT_COLORS).toContain(addressBookDotColor({ id: "default" }));
    expect(ADDRESS_BOOK_DOT_COLORS).toContain(addressBookDotColor({ id: "group-eng" }));
    expect(addressBookDotColor({ id: "default" })).not.toBe(
      addressBookDotColor({ id: "group-eng" }),
    );
  });

  it("uses an override map and falls back to the hash", () => {
    const hashed = addressBookDotColor({ id: "default" }, {});
    const override = ADDRESS_BOOK_DOT_COLORS.find((color) => color !== hashed) ?? "#111111";
    expect(addressBookDotColor({ id: "default" }, { default: override })).toBe(override);
    expect(addressBookDotColor({ id: "default" }, {})).toBe(hashed);
    expect(addressBookDotColor({ id: "group-eng" }, { default: override })).toBe(
      addressBookDotColor({ id: "group-eng" }, {}),
    );
  });
});

describe("enabledAddressBookIds", () => {
  it("returns enabled ids only and ignores blank keys", () => {
    expect(enabledAddressBookIds({ default: true, work: false, " ": true })).toEqual(["default"]);
    expect(enabledAddressBookIds({ "group-admin": true, "group-administrators": true })).toEqual([
      "group-admin",
      "group-administrators",
    ]);
    expect(enabledAddressBookIds(null)).toEqual([]);
  });
});

describe("firstEnabledAddressBookId", () => {
  it("returns the first enabled book and skips disabled keys", () => {
    expect(firstEnabledAddressBookId({ default: true })).toBe("default");
    expect(firstEnabledAddressBookId({ work: false, "group-eng": true })).toBe("group-eng");
    expect(firstEnabledAddressBookId({ work: false })).toBeUndefined();
    expect(firstEnabledAddressBookId({})).toBeUndefined();
    expect(firstEnabledAddressBookId(null)).toBeUndefined();
  });
});

describe("groupAddressBookColor", () => {
  it("reuses addressBookDotColor and does not hash the group id", () => {
    expect(groupAddressBookColor("group-eng")).toBe(addressBookDotColor({ id: "group-eng" }));
    expect(groupAddressBookColor({ addressBookIds: { default: true } })).toBe(
      addressBookDotColor({ id: "default" }),
    );
    expect(groupAddressBookColor({ addressBookIds: { default: true } })).not.toBe(
      addressBookDotColor({ id: "card-group-friends" }),
    );
    expect(groupAddressBookColor(undefined)).toBeUndefined();
    expect(groupAddressBookColor({ addressBookIds: {} })).toBeUndefined();
  });

  it("uses the address-book color override", () => {
    expect(
      groupAddressBookColor({ addressBookIds: { default: true } }, { default: "#22c55e" }),
    ).toBe("#22c55e");
  });
});
