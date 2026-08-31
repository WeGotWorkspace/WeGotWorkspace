import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsListPanel } from "./contacts-list-panel";
import { defaultContactsLabels } from "./contacts-labels";
import type { ContactCard } from "./contacts-types";

afterEach(() => {
  cleanup();
});

const orgCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-acme",
  uid: "urn:uuid:acme",
  kind: "org",
  organizations: {
    "org-1": { "@type": "Organization", name: "Acme Corp" },
  },
  addressBookIds: { default: true },
} as unknown as ContactCard;

const personCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane",
  uid: "urn:uuid:jane",
  kind: "individual",
  name: { full: "Jane Doe" },
  addressBookIds: { default: true },
} as unknown as ContactCard;

describe("ContactsListPanel avatars", () => {
  it("renders a company icon for org cards and initials for people", () => {
    const panel = ContactsListPanel({
      L: defaultContactsLabels,
      sidebarOpen: true,
      onToggleSidebar: vi.fn(),
      viewLabel: "All contacts",
      view: "all",
      selectedGroupId: null,
      selectedIds: [],
      selectionMode: false,
      listLoading: false,
      visibleCards: [orgCard, personCard],
      searchQuery: "",
      setSearchQuery: vi.fn(),
      searchInputRef: createRef<HTMLInputElement>(),
      isTouch: false,
      activeId: "",
      isItemDragging: () => false,
      handleSelect: vi.fn(),
      enterSelectionFor: vi.fn(),
      itemDragHandlers: () => ({}),
      onSwipeDelete: vi.fn(),
      onSwipeRemoveFromGroup: vi.fn(),
      selectionBar: null,
    });
    const { container } = render(<>{panel.listContent}</>);
    const orgRow = container.querySelector('[data-list-item-id="card-acme"]');
    const personRow = container.querySelector('[data-list-item-id="card-jane"]');
    expect(orgRow?.querySelector(".contacts-list-panel__avatar .contacts-org-icon")).toBeTruthy();
    expect(orgRow?.querySelector(".user-avatar__mark")?.textContent).not.toMatch(/A/);
    expect(personRow?.querySelector(".contacts-org-icon")).toBeNull();
    expect(personRow?.querySelector(".user-avatar__mark")?.textContent).toMatch(/J/);
  });
});
