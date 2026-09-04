import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContactsImportDialog,
  contactsImportDialogLabelsFrom,
} from "@/contacts-core/src/contacts-import-dialog";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

const labels = contactsImportDialogLabelsFrom(defaultContactsLabels);

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

const viewOnlySharee: ContactsAddressBookRow = {
  id: "shared-42",
  name: "Alice",
  description: null,
  sortOrder: 3,
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

const sampleFiles = [new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf")];

function bookTrigger() {
  return screen.getByRole("combobox", { name: defaultContactsLabels.importDestinationLegend });
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

describe("ContactsImportDialog", () => {
  beforeEach(() => {
    cleanup();
    stubMatchMedia();
  });

  it("shows the address book picker and imports into the default book", () => {
    const onImport = vi.fn();
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    expect(screen.getByText(defaultContactsLabels.importDialogTitle)).toBeTruthy();
    expect(bookTrigger()).toBeTruthy();
    expect(selectedBookLabel()).toBe("Personal");

    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(sampleFiles, "default");
  });

  it("submits the selected book id, not a name prefix (Admin vs Administrators)", () => {
    const onImport = vi.fn();
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, adminBook, administratorsBook]}
        view="book:group-administrators"
        labels={labels}
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    expect(selectedBookLabel()).toBe("Administrators");
    fireEvent.click(bookTrigger());
    fireEvent.click(screen.getByRole("option", { name: /^Admin$/ }));
    expect(selectedBookLabel()).toBe("Admin");

    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.importSubmit }));

    expect(onImport).toHaveBeenCalledWith(sampleFiles, "group-admin");
  });

  it("defaults to the current view's writable book", () => {
    const onImport = vi.fn();
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="book:group-eng"
        labels={labels}
        onClose={vi.fn()}
        onImport={onImport}
      />,
    );

    expect(selectedBookLabel()).toBe("Engineering");
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.importSubmit }));
    expect(onImport).toHaveBeenCalledWith(sampleFiles, "group-eng");
  });

  it("does not list view-only or inbound shared books", () => {
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook, viewOnlySharee, editSharee]}
        view="all"
        labels={labels}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    fireEvent.click(bookTrigger());
    expect(screen.getByRole("option", { name: /Personal/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Engineering/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Bob/ })).toBeNull();
  });

  it("keeps a long import error inside the dialog", () => {
    const longError =
      "Upload too large. Current server post_max_size is 8M. Expected JSON from http://localhost:5174/api/v1/contacts/cards/import?addressBookId=group-administrators (200)";
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="all"
        labels={labels}
        error={longError}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByText(longError)).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultContactsLabels.cancel })).toBeTruthy();
    expect(document.querySelector(".contacts-import-dialog__error")).toBeTruthy();
  });

  it("shows import progress while a batch is uploading", () => {
    render(
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="all"
        labels={labels}
        busy
        progress={{ importedCards: 40, totalCards: 200, batchIndex: 2, batchCount: 4 }}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByText("Imported 40 of 200 (batch 2 of 4)")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(bookTrigger()).toBeTruthy();
  });
});
