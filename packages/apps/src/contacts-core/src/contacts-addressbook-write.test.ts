import { describe, expect, it } from "vitest";
import {
  addressBookDialogFromRow,
  addressBookPatchOp,
  contactsAddressBookDisplayName,
  canCreateGroupInAddressBook,
  canDeleteAddressBook,
  canHideSharedAddressBook,
  canOpenAddressBookSettings,
  canRenameAddressBook,
  canShareAddressBook,
  canWriteOwnedAddressBook,
  defaultCreateGroupAddressBookId,
  defaultWritableAddressBookId,
  writableGroupAddressBooks,
  writableOwnedAddressBooks,
  contactsBookViewKey,
  isSharedAddressBook,
  isViewOnlyAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

const ownerBook: ContactsAddressBookRow = {
  id: "default",
  name: "Ada",
  description: null,
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

const teamBook: ContactsAddressBookRow = {
  id: "group-eng",
  name: "Engineering",
  description: null,
  sortOrder: 1,
  isDefault: false,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

const viewOnlySharee: ContactsAddressBookRow = {
  id: "shared-42",
  name: "Alice",
  description: null,
  sortOrder: 2,
  isDefault: false,
  isSubscribed: true,
  isSharee: true,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
};

const editSharee: ContactsAddressBookRow = {
  ...viewOnlySharee,
  id: "shared-99",
  name: "Bob",
  myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
};

describe("contacts-addressbook-write", () => {
  it("forces Personal on the owned default book and keeps sharee and group names", () => {
    expect(contactsAddressBookDisplayName(ownerBook)).toBe("Personal");
    expect(contactsAddressBookDisplayName(ownerBook, "Persoonlijk")).toBe("Persoonlijk");
    expect(contactsAddressBookDisplayName(viewOnlySharee)).toBe("Alice");
    expect(contactsAddressBookDisplayName(teamBook)).toBe("Engineering");
  });

  it("locks rename and delete for every book", () => {
    expect(canRenameAddressBook(ownerBook)).toBe(false);
    expect(canRenameAddressBook(teamBook)).toBe(false);
    expect(canRenameAddressBook(viewOnlySharee)).toBe(false);
    expect(canRenameAddressBook()).toBe(false);
    expect(canDeleteAddressBook(ownerBook)).toBe(false);
    expect(canDeleteAddressBook(teamBook)).toBe(false);
    expect(canDeleteAddressBook(viewOnlySharee)).toBe(false);
    expect(canDeleteAddressBook()).toBe(false);
  });

  it("reads canShare from myRights.mayShare", () => {
    expect(canShareAddressBook(ownerBook)).toBe(true);
    expect(canShareAddressBook(teamBook)).toBe(true);
    expect(canShareAddressBook(viewOnlySharee)).toBe(false);
    expect(canShareAddressBook(editSharee)).toBe(false);
    expect(canShareAddressBook()).toBe(false);
  });

  it("treats only isSharee rows as inbound shares", () => {
    expect(isSharedAddressBook(ownerBook)).toBe(false);
    expect(isSharedAddressBook(teamBook)).toBe(false);
    expect(isSharedAddressBook(viewOnlySharee)).toBe(true);
    expect(isSharedAddressBook()).toBe(false);
  });

  it("opens settings for share owners and sharee-hide", () => {
    expect(canOpenAddressBookSettings(ownerBook)).toBe(true);
    expect(canOpenAddressBookSettings(teamBook)).toBe(true);
    expect(canOpenAddressBookSettings(viewOnlySharee)).toBe(true);
    expect(canHideSharedAddressBook(viewOnlySharee)).toBe(true);
    expect(canHideSharedAddressBook(editSharee)).toBe(true);
    expect(canHideSharedAddressBook(ownerBook)).toBe(false);
    expect(
      canHideSharedAddressBook({
        ...viewOnlySharee,
        myRights: { ...viewOnlySharee.myRights, mayDelete: false },
      }),
    ).toBe(false);
    expect(
      canOpenAddressBookSettings({
        ...ownerBook,
        myRights: { ...ownerBook.myRights, mayShare: false },
      }),
    ).toBe(false);
  });

  it("limits create-group and import targets to personal default and writable team books", () => {
    expect(canWriteOwnedAddressBook(ownerBook)).toBe(true);
    expect(canCreateGroupInAddressBook(ownerBook)).toBe(true);
    expect(canCreateGroupInAddressBook(teamBook)).toBe(true);
    expect(canCreateGroupInAddressBook(viewOnlySharee)).toBe(false);
    expect(canCreateGroupInAddressBook(editSharee)).toBe(false);
    expect(
      canCreateGroupInAddressBook({
        ...ownerBook,
        myRights: { ...ownerBook.myRights, mayWrite: false },
      }),
    ).toBe(false);
    expect(
      writableOwnedAddressBooks([ownerBook, teamBook, viewOnlySharee, editSharee]).map(
        (book) => book.id,
      ),
    ).toEqual(["default", "group-eng"]);
    expect(
      writableGroupAddressBooks([ownerBook, teamBook, viewOnlySharee, editSharee]).map(
        (book) => book.id,
      ),
    ).toEqual(["default", "group-eng"]);
    expect(defaultWritableAddressBookId("all", [ownerBook, teamBook])).toBe("default");
    expect(defaultCreateGroupAddressBookId("all", [ownerBook, teamBook])).toBe("default");
    expect(defaultCreateGroupAddressBookId("book:group-eng", [ownerBook, teamBook])).toBe(
      "group-eng",
    );
    expect(defaultCreateGroupAddressBookId("book:shared-42", [ownerBook, viewOnlySharee])).toBe(
      "default",
    );
    expect(defaultCreateGroupAddressBookId("all", [viewOnlySharee, editSharee])).toBeUndefined();

    const adminBook: ContactsAddressBookRow = {
      ...teamBook,
      id: "group-admin",
      name: "Admin",
    };
    const administratorsBook: ContactsAddressBookRow = {
      ...teamBook,
      id: "group-administrators",
      name: "Administrators",
      sortOrder: 2,
    };
    expect(canCreateGroupInAddressBook(adminBook)).toBe(true);
    expect(canCreateGroupInAddressBook(administratorsBook)).toBe(true);
    expect(
      defaultCreateGroupAddressBookId("book:group-administrators", [adminBook, administratorsBook]),
    ).toBe("group-administrators");
    expect(
      defaultCreateGroupAddressBookId("book:group-admin", [adminBook, administratorsBook]),
    ).toBe("group-admin");
  });

  it("marks view-only when mayWrite is false", () => {
    expect(isViewOnlyAddressBook(viewOnlySharee)).toBe(true);
    expect(isViewOnlyAddressBook(editSharee)).toBe(false);
    expect(isViewOnlyAddressBook(ownerBook)).toBe(false);
  });

  it("builds a share-only dialog state from the row", () => {
    expect(addressBookDialogFromRow(ownerBook)).toEqual({
      bookId: "default",
      name: "Personal",
      mayShare: true,
      isSharee: false,
      shareWith: null,
    });
    expect(addressBookDialogFromRow(viewOnlySharee)).toMatchObject({
      bookId: "shared-42",
      mayShare: false,
      isSharee: true,
    });
  });

  it("builds book view keys and optional-chains patchAddressBook", () => {
    expect(contactsBookViewKey("default")).toBe("book:default");
    expect(addressBookPatchOp(undefined)).toBeUndefined();
    expect(addressBookPatchOp({})).toBeUndefined();
    const patchAddressBook = async () => ownerBook;
    expect(addressBookPatchOp({ patchAddressBook })).toBe(patchAddressBook);
  });
});
