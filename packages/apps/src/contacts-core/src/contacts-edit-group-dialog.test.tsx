import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import {
  ContactsEditGroupDialog,
  contactsEditGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-edit-group-dialog";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

const labels = contactsEditGroupDialogLabelsFrom(defaultContactsLabels);

const ownerBook = { id: "default", name: "Ada" };
const adminBook = { id: "group-admin", name: "Admin" };
const administratorsBook = { id: "group-administrators", name: "Administrators" };

function bookTrigger() {
  return screen.getByRole("combobox", { name: defaultContactsLabels.createGroupAddressBookLabel });
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

describe("ContactsEditGroupDialog", () => {
  beforeEach(() => {
    cleanup();
    stubMatchMedia();
  });

  it("submits the renamed group without changing the address book", () => {
    const onConfirm = vi.fn();
    render(
      <ContactsEditGroupDialog
        open
        name="Friends"
        addressBookIds={{ default: true }}
        books={[ownerBook]}
        labels={labels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(defaultContactsLabels.renameGroup)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(defaultContactsLabels.createGroupNameLabel), {
      target: { value: "Close Friends" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith("Close Friends");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const title = screen.getByText(defaultContactsLabels.renameGroup);
    const icon = title.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "default" }),
    );
  });

  it("shows a disabled address-book dropdown bound to the group's book", () => {
    render(
      <ContactsEditGroupDialog
        open
        name="Friends"
        addressBookIds={{ default: true }}
        books={[ownerBook, adminBook, administratorsBook]}
        labels={labels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect((bookTrigger() as HTMLButtonElement).disabled).toBe(true);
    expect(selectedBookLabel()).toBe("Personal");
  });

  it("displays Administrators when the group lives in that book", () => {
    render(
      <ContactsEditGroupDialog
        open
        name="Leads"
        addressBookIds={{ "group-administrators": true }}
        books={[ownerBook, adminBook, administratorsBook]}
        labels={labels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect((bookTrigger() as HTMLButtonElement).disabled).toBe(true);
    expect(selectedBookLabel()).toBe("Administrators");
  });

  it("displays Admin when the group lives in that book", () => {
    render(
      <ContactsEditGroupDialog
        open
        name="Ops"
        addressBookIds={{ "group-admin": true }}
        books={[ownerBook, adminBook, administratorsBook]}
        labels={labels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect((bookTrigger() as HTMLButtonElement).disabled).toBe(true);
    expect(selectedBookLabel()).toBe("Admin");
  });

  it("hides delete unless canDelete and onDelete are set", () => {
    const { rerender } = render(
      <ContactsEditGroupDialog
        open
        name="Friends"
        labels={labels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: defaultContactsLabels.deleteGroup })).toBeNull();

    rerender(
      <ContactsEditGroupDialog
        open
        name="Friends"
        labels={labels}
        canDelete
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: defaultContactsLabels.deleteGroup })).toBeNull();
  });

  it("confirms delete from the footer when canDelete", () => {
    const onDelete = vi.fn();
    render(
      <ContactsEditGroupDialog
        open
        name="Friends"
        labels={labels}
        canDelete
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.deleteGroup }));
    expect(screen.getByText(defaultContactsLabels.deleteGroupTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
