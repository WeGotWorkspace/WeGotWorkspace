import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContactsCreateGroupDialog,
  contactsCreateGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-create-group-dialog";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

const labels = contactsCreateGroupDialogLabelsFrom(defaultContactsLabels);

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

const adminBook: ContactsAddressBookRow = {
  id: "group-admin",
  name: "Admin",
  description: null,
  sortOrder: 1,
  isDefault: false,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

const administratorsBook: ContactsAddressBookRow = {
  id: "group-administrators",
  name: "Administrators",
  description: null,
  sortOrder: 2,
  isDefault: false,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

/** The ghost trigger is named by its book; the row's caption labels it (`htmlFor`). */
function bookTrigger() {
  return screen.getByLabelText(defaultContactsLabels.createGroupAddressBookLabel, {
    selector: "[role=combobox]",
  });
}

function selectedBookLabel() {
  return bookTrigger().textContent?.replace(/\s+/g, " ").trim() ?? "";
}

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

describe("ContactsCreateGroupDialog", () => {
  beforeEach(() => {
    cleanup();
    stubMatchMedia();
  });

  it("submits the name and selected address book", () => {
    const onConfirm = vi.fn();
    render(
      <ContactsCreateGroupDialog
        open
        books={[ownerBook, teamBook]}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(defaultContactsLabels.newGroup)).toBeTruthy();
    expect(screen.getByText(defaultContactsLabels.createGroupAddressBookHint)).toBeTruthy();
    expect(screen.getByLabelText(defaultContactsLabels.createGroupAddressBookLabel)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(defaultContactsLabels.createGroupNameLabel), {
      target: { value: "Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.createGroupButton }));

    expect(onConfirm).toHaveBeenCalledWith("Studio", "default");
  });

  it("defaults the picker to the writable book in view", () => {
    const onConfirm = vi.fn();
    render(
      <ContactsCreateGroupDialog
        open
        books={[ownerBook, teamBook]}
        view="book:group-eng"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultContactsLabels.createGroupNameLabel), {
      target: { value: "Eng leads" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.createGroupButton }));

    expect(onConfirm).toHaveBeenCalledWith("Eng leads", "group-eng");
  });

  it("disables create until the name is filled", () => {
    render(
      <ContactsCreateGroupDialog
        open
        books={[ownerBook]}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: defaultContactsLabels.createGroupButton,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: defaultContactsLabels.deleteGroup })).toBeNull();
  });

  it("keeps Administrators selected while typing a group name", () => {
    const onConfirm = vi.fn();
    const books = [ownerBook, adminBook, administratorsBook];
    const { rerender } = render(
      <ContactsCreateGroupDialog
        open
        books={books}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(bookTrigger());
    fireEvent.click(screen.getByRole("option", { name: /^Administrators$/ }));
    expect(selectedBookLabel()).toBe("Administrators");

    const nameField = screen.getByLabelText(defaultContactsLabels.createGroupNameLabel);
    fireEvent.keyDown(nameField, { key: "A" });
    fireEvent.change(nameField, { target: { value: "Admin leads" } });
    fireEvent.keyDown(bookTrigger(), { key: "A" });

    rerender(
      <ContactsCreateGroupDialog
        open
        books={[...books]}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(selectedBookLabel()).toBe("Administrators");
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.createGroupButton }));
    expect(onConfirm).toHaveBeenCalledWith("Admin leads", "group-administrators");
  });

  it("still allows selecting the Admin address book", () => {
    const onConfirm = vi.fn();
    render(
      <ContactsCreateGroupDialog
        open
        books={[ownerBook, adminBook, administratorsBook]}
        view="book:group-administrators"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(selectedBookLabel()).toBe("Administrators");
    fireEvent.click(bookTrigger());
    fireEvent.click(screen.getByRole("option", { name: /^Admin$/ }));
    expect(selectedBookLabel()).toBe("Admin");

    fireEvent.change(screen.getByLabelText(defaultContactsLabels.createGroupNameLabel), {
      target: { value: "Ops" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.createGroupButton }));

    expect(onConfirm).toHaveBeenCalledWith("Ops", "group-admin");
  });
});
