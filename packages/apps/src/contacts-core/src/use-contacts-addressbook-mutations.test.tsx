import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { useContactsAddressBookMutations } from "@/contacts-core/src/use-contacts-addressbook-mutations";

const { mockShow, mockShowError } = vi.hoisted(() => ({
  mockShow: vi.fn(),
  mockShowError: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: mockShow,
    showError: mockShowError,
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

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

const sharedBook: ContactsAddressBookRow = {
  id: "shared-42",
  name: "Alice",
  description: null,
  sortOrder: 1,
  isDefault: false,
  isSubscribed: true,
  isSharee: true,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
};

describe("useContactsAddressBookMutations", () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockShowError.mockReset();
  });

  it("opens a share-only dialog for owners and sharees", () => {
    const { result } = renderHook(() =>
      useContactsAddressBookMutations({
        labels: defaultContactsLabels,
        addressBooks: [ownerBook, sharedBook],
        view: "all",
        selectView: vi.fn(),
        operations: { patchAddressBook: vi.fn() },
      }),
    );

    act(() => {
      result.current.openEditAddressBookDialog(ownerBook);
    });
    expect(result.current.addressBookDialog).toMatchObject({
      bookId: "default",
      name: "Ada",
      mayShare: true,
      isSharee: false,
    });

    act(() => {
      result.current.openEditAddressBookDialog(sharedBook);
    });
    expect(result.current.addressBookDialog).toMatchObject({
      bookId: "shared-42",
      mayShare: false,
      isSharee: true,
    });
  });

  it("patches shareWith through optional patchAddressBook", async () => {
    const patchAddressBook = vi.fn().mockResolvedValue({
      ...ownerBook,
      shareWith: { alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false } },
    });
    const { result } = renderHook(() =>
      useContactsAddressBookMutations({
        labels: defaultContactsLabels,
        addressBooks: [ownerBook],
        view: "all",
        selectView: vi.fn(),
        operations: { patchAddressBook },
      }),
    );

    act(() => {
      result.current.openEditAddressBookDialog(ownerBook);
    });
    await act(async () => {
      await result.current.patchShareWith("default", {
        alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
      });
    });

    expect(patchAddressBook).toHaveBeenCalledWith("default", {
      shareWith: { alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false } },
    });
    expect(result.current.addressBookDialog?.shareWith).toEqual({
      alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
    });
  });

  it("hides a sharee book via isSubscribed false", async () => {
    const patchAddressBook = vi.fn().mockResolvedValue({ ...sharedBook, isSubscribed: false });
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useContactsAddressBookMutations({
        labels: defaultContactsLabels,
        addressBooks: [ownerBook, sharedBook],
        view: "book:shared-42",
        selectView,
        operations: { patchAddressBook },
      }),
    );

    await act(async () => {
      await result.current.hideSharedAddressBook("shared-42");
    });

    expect(patchAddressBook).toHaveBeenCalledWith("shared-42", { isSubscribed: false });
    expect(result.current.books.map((book) => book.id)).toEqual(["default"]);
    expect(selectView).toHaveBeenCalledWith("all");
    expect(mockShow).toHaveBeenCalledWith(defaultContactsLabels.toastAddressBookShareRemoved);
  });

  it("throws the offline label when patchAddressBook is missing", async () => {
    const { result } = renderHook(() =>
      useContactsAddressBookMutations({
        labels: defaultContactsLabels,
        addressBooks: [ownerBook],
        view: "all",
        selectView: vi.fn(),
      }),
    );

    await expect(
      result.current.patchShareWith("default", {
        alice: { mayRead: true, mayWrite: false },
      }),
    ).rejects.toThrow(defaultContactsLabels.shareAddressBookOffline);
  });
});
