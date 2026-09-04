import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsSidebarBookRows } from "./contacts-sidebar-book-rows";
import { addressBookDotColor } from "./contacts-addressbook-color";
import type { ContactsAddressBookRow } from "./contacts-addressbook-write";
import type { ContactCard } from "./contacts-types";
import { CONTACTS_VIEW_PREFS_STORAGE_KEY, persistAddressBookColor } from "./contacts-view-prefs";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
});

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

const viewOnlySharee: ContactsAddressBookRow = {
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

describe("ContactsSidebarBookRows", () => {
  it("renders a colored visibility checkbox and the view-only mark", () => {
    const onToggleVisibility = vi.fn();
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ContactsSidebarBookRows
          books={[ownerBook, viewOnlySharee]}
          view="all"
          editLabel="Address book settings"
          viewOnlyLabel="View only"
          hiddenAddressBookIds={new Set()}
          onToggleVisibility={onToggleVisibility}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const row = container.querySelector(".collection-sidebar-row") as HTMLElement | null;
    expect(row?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor(ownerBook),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Personal" }));
    expect(onToggleVisibility).toHaveBeenCalledWith("default");
    expect(screen.getByRole("img", { name: "View only" })).toBeTruthy();
  });

  it("tints the row from a device-local color override", () => {
    persistAddressBookColor("default", "#ec4899");
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ContactsSidebarBookRows
          books={[ownerBook]}
          view="all"
          editLabel="Address book settings"
          viewOnlyLabel="View only"
          hiddenAddressBookIds={new Set()}
          onToggleVisibility={vi.fn()}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const row = container.querySelector(".collection-sidebar-row") as HTMLElement | null;
    expect(row?.style.getPropertyValue("--collection-row-color")).toBe("#ec4899");
    expect(addressBookDotColor(ownerBook)).toBe("#ec4899");
  });

  it("nests same-book groups under the book and hides the fold when empty", () => {
    const friendsGroup = {
      "@type": "Card",
      version: "1.0",
      id: "group-friends",
      uid: "urn:uuid:group-friends",
      kind: "group",
      name: { full: "Friends" },
      addressBookIds: { default: true },
    } as unknown as ContactCard;
    const colleaguesGroup = {
      ...friendsGroup,
      id: "group-alice-colleagues",
      name: { full: "Colleagues" },
      addressBookIds: { "shared-42": true },
    } as unknown as ContactCard;
    const onSelectGroup = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <ul>
          <ContactsSidebarBookRows
            books={[ownerBook, viewOnlySharee]}
            groups={[friendsGroup, colleaguesGroup]}
            view="group:group-friends"
            editLabel="Address book settings"
            viewOnlyLabel="View only"
            hiddenAddressBookIds={new Set()}
            onToggleVisibility={vi.fn()}
            onSelect={vi.fn()}
            onEdit={vi.fn()}
            canEditGroup={() => true}
            onSelectGroup={onSelectGroup}
            onEditGroup={vi.fn()}
          />
        </ul>
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Friends" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Colleagues" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Personal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Alice" })).toBeTruthy();
    const personal = screen.getByText("Personal").closest(".collection-sidebar-row");
    expect(personal?.className).toMatch(/collection-sidebar-row--related/);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Personal" }));
    expect(screen.queryByRole("button", { name: "Friends" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Personal" }));
    fireEvent.click(screen.getByRole("button", { name: "Friends" }));
    expect(onSelectGroup).toHaveBeenCalledWith("group-friends");
  });
});
