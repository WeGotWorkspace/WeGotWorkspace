import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ContactsDetailAddressBookSelect } from "./contacts-detail-address-book-select";
import { defaultContactsLabels } from "./contacts-labels";
import type { ContactCard } from "@/lib/models/contacts-types";

const twoBooks = [
  { id: "default", name: "Ada", isDefault: true },
  { id: "group-eng", name: "Engineering" },
];

const card = { id: "c-1", addressBookIds: { default: true } } as unknown as ContactCard;

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

function renderSelect(props: Partial<ComponentProps<typeof ContactsDetailAddressBookSelect>> = {}) {
  return render(
    <ContactsDetailAddressBookSelect
      card={card}
      labels={defaultContactsLabels}
      addressBooks={twoBooks}
      writableBooks={twoBooks}
      canMove
      onMove={vi.fn()}
      {...props}
    />,
  );
}

describe("ContactsDetailAddressBookSelect", () => {
  beforeEach(stubSelectEnv);
  afterEach(() => {
    cleanup();
  });

  it("shows the book as a ghost dropdown and moves to another writable book", () => {
    const onMove = vi.fn();
    renderSelect({ onMove });
    const trigger = screen.getByRole("combobox", {
      name: defaultContactsLabels.personalAddressBook,
    });
    expect(trigger.className).toContain("collection-ghost-select");
    expect(trigger.className).toContain("contacts-address-book-select--ghost");
    expect(trigger.textContent).toBe(defaultContactsLabels.personalAddressBook);
    expect(trigger.querySelector(".collection-color-dot")).toBeTruthy();
    expect(trigger.querySelector(".collection-ghost-select__chevron")).toBeTruthy();
    expect(trigger.style.getPropertyValue("--collection-row-color")).toBeTruthy();

    fireEvent.click(trigger);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultContactsLabels.personalAddressBook,
      "Engineering",
    ]);
    expect(screen.queryByRole("option", { name: /create|new address book/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Engineering" }));
    expect(onMove).toHaveBeenCalledWith("group-eng");
  });

  it("only names the book when the contact cannot move", () => {
    renderSelect({
      card: { id: "c-2", addressBookIds: { "group-eng": true } } as unknown as ContactCard,
      writableBooks: [],
      canMove: false,
    });
    const trigger = screen.getByRole("combobox", { name: "Engineering" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(trigger.querySelector(".collection-ghost-select__chevron")).toBeNull();
  });

  it("renders nothing for a card without an address book", () => {
    const { container } = renderSelect({
      card: { id: "c-3", addressBookIds: {} } as unknown as ContactCard,
    });
    expect(container.firstChild).toBeNull();
  });
});
