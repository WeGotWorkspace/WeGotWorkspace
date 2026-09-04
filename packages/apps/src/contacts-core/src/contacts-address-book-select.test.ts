import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { booksForAddressBookSelect } from "@/contacts-core/src/contacts-address-book-select";

const selectSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "contacts-address-book-select.tsx"),
  "utf8",
);

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

describe("ContactsAddressBookSelect icons", () => {
  it("reuses the Notes notebook glyph tinted with the book color", () => {
    expect(selectSource).toMatch(/NotesNotebookColorIcon/);
    expect(selectSource).toMatch(/addressBookDotColor\(book, overrides\)/);
    expect(selectSource).toMatch(/--collection-row-color/);
    expect(selectSource).not.toMatch(/ContactsGroupIcon/);
  });
});
