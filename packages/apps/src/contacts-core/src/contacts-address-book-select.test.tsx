import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  booksForAddressBookSelect,
  ContactsAddressBookSelect,
} from "@/contacts-core/src/contacts-address-book-select";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { TooltipProvider } from "@/ui/tooltip";

const admin = { id: "group-admin", name: "Admin" };
const administrators = { id: "group-administrators", name: "Administrators" };
const twoBooks = [
  { id: "default", name: "Ada", isDefault: true as const },
  { id: "group-eng", name: "Engineering" },
];

function stubSelectEnv() {
  Element.prototype.scrollIntoView = vi.fn();
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

function renderSelect(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

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

describe("ContactsAddressBookSelect", () => {
  beforeEach(stubSelectEnv);
  afterEach(() => {
    cleanup();
  });

  it("reuses ColorSwatchTrigger for the swatch variant (icon + chevron, no caption)", () => {
    const { container } = renderSelect(
      <ContactsAddressBookSelect
        variant="toolbar"
        triggerVariant="swatch"
        label={defaultContactsLabels.toolbarMoveToAddressBook}
        books={twoBooks}
        value="default"
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: defaultContactsLabels.personalAddressBook,
    });
    expect(trigger.className).toContain("color-swatch-trigger");
    expect(trigger.className).toContain("contacts-address-book-select--swatch");
    expect(trigger.querySelector(".color-swatch-trigger__chevron")).toBeTruthy();
    expect(trigger.querySelector(".notes-notebook-color-icon")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__caption")).toBeNull();
    expect(trigger.querySelector(".contacts-address-book-select__name")).toBeNull();
    expect(container.querySelector(".select-trigger__icon")).toBeNull();
  });

  it("moves when choosing another address book from the swatch trigger", () => {
    const onValueChange = vi.fn();
    renderSelect(
      <ContactsAddressBookSelect
        variant="toolbar"
        triggerVariant="swatch"
        label={defaultContactsLabels.toolbarMoveToAddressBook}
        books={twoBooks}
        value="default"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: defaultContactsLabels.personalAddressBook }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Engineering" }));
    expect(onValueChange).toHaveBeenCalledWith("group-eng");
  });
});
