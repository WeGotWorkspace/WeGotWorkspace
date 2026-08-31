import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { useContactsSidebarModel } from "@/contacts-core/src/use-contacts-sidebar-model";

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

const sharedBook: ContactsAddressBookRow = {
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

describe("useContactsSidebarModel", () => {
  it("keeps All Contacts plus owned/team vs Shared with me partitions", () => {
    const { result } = renderHook(() =>
      useContactsSidebarModel({
        labels: defaultContactsLabels,
        view: "all",
        addressBooks: [sharedBook, teamBook, ownerBook],
        selectView: vi.fn(),
      }),
    );

    expect(result.current.primarySidebarItems.map((item) => item.label)).toEqual(["All contacts"]);
    expect(result.current.ownedAddressBooks.map((item) => item.name)).toEqual([
      "Ada",
      "Engineering",
    ]);
    expect(result.current.sharedAddressBooks.map((item) => item.name)).toEqual(["Alice"]);
  });

  it("does not treat a mayShare-false owned book as Shared with me", () => {
    const lockedExtra: ContactsAddressBookRow = {
      ...ownerBook,
      id: "work",
      name: "Work",
      isDefault: false,
      myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
    };
    const { result } = renderHook(() =>
      useContactsSidebarModel({
        labels: defaultContactsLabels,
        view: "all",
        addressBooks: [ownerBook, lockedExtra],
        selectView: vi.fn(),
      }),
    );
    expect(result.current.ownedAddressBooks.map((item) => item.id)).toEqual(["default", "work"]);
    expect(result.current.sharedAddressBooks).toEqual([]);
  });
});
