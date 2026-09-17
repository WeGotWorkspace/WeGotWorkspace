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

const ownerAndShared = [ownerBook, sharedBook];
const ownerOnly = [ownerBook];

describe("useContactsAddressBookMutations", () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockShowError.mockReset();
  });

  it("opens a share-only dialog for owners and sharees", () => {
    const { result } = renderHook(() =>
      useContactsAddressBookMutations({
        labels: defaultContactsLabels,
        addressBooks: ownerAndShared,
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
      name: "Personal",
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
        addressBooks: ownerOnly,
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
});
