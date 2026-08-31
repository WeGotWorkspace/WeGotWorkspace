import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContactsAddressBookDialog,
  contactsAddressBookDialogLabelsFrom,
} from "@/contacts-core/src/contacts-addressbook-dialog";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

const labels = contactsAddressBookDialogLabelsFrom(defaultContactsLabels);

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ContactsAddressBookDialog", () => {
  beforeEach(() => {
    cleanup();
    stubMatchMedia();
  });

  it("keeps the name read-only and has no delete control", () => {
    render(
      <ContactsAddressBookDialog
        dialog={{
          bookId: "default",
          name: "Ada",
          mayShare: true,
          isSharee: false,
          shareWith: null,
        }}
        labels={labels}
        onClose={vi.fn()}
        share={{
          online: true,
          onSearchPrincipals: async () => [],
          onPatchShareWith: async () => undefined,
        }}
      />,
    );

    const name = screen.getByLabelText(defaultContactsLabels.addressBookNameLabel);
    expect(name).toBeInstanceOf(HTMLInputElement);
    expect((name as HTMLInputElement).readOnly).toBe(true);
    expect((name as HTMLInputElement).value).toBe("Ada");
    expect(screen.getByText(defaultContactsLabels.shareAddressBookTitle)).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.delete })).toBeNull();
    expect(
      screen.getByRole("button", { name: defaultContactsLabels.addressBookDialogDone }),
    ).toBeTruthy();
  });

  it("hides share UI for a sharee and offers remove", () => {
    render(
      <ContactsAddressBookDialog
        dialog={{
          bookId: "shared-42",
          name: "Alice",
          mayShare: false,
          isSharee: true,
          shareWith: null,
        }}
        labels={labels}
        onClose={vi.fn()}
        onRemoveShared={vi.fn()}
      />,
    );

    expect(screen.queryByText(defaultContactsLabels.shareAddressBookTitle)).toBeNull();
    expect(
      screen.getByRole("button", { name: defaultContactsLabels.removeSharedAddressBook }),
    ).toBeTruthy();
  });
});
