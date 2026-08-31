import { describe, expect, it } from "vitest";
import { booksForAddressBookSelect } from "@/contacts-core/src/contacts-address-book-select";

const admin = { id: "group-admin", name: "Admin" };
const administrators = { id: "group-administrators", name: "Administrators" };

describe("booksForAddressBookSelect", () => {
  it("keeps the list when the selected id is already present", () => {
    expect(booksForAddressBookSelect([admin, administrators], "group-admin")).toEqual([
      admin,
      administrators,
    ]);
  });

  it("appends a fallback option for a missing selected id", () => {
    expect(booksForAddressBookSelect([admin], "group-administrators")).toEqual([
      admin,
      { id: "group-administrators", name: "group-administrators" },
    ]);
  });
});
