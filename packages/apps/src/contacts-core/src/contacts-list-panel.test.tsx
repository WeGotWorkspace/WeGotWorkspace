import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { addressBookDotColor } from "./contacts-addressbook-color";
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

const personWithPhoto = {
  "@type": "Card",
  version: "1.0",
  id: "card-photo-jane",
  uid: "urn:uuid:photo-jane",
  kind: "individual",
  name: { full: "Jane Photo" },
  addressBookIds: { default: true },
  media: {
    "media-1": {
      "@type": "Media",
      kind: "photo",
      uri: "https://example.com/photos/jane.jpg",
    },
  },
} as unknown as ContactCard;

function ListHarness({
  visibleCards,
  listLoading = false,
  listRefreshing = false,
  onRefreshList,
  slot = "both",
}: {
  visibleCards: ContactCard[];
  listLoading?: boolean;
  listRefreshing?: boolean;
  onRefreshList?: () => void;
  slot?: "list" | "header" | "both";
}) {
  // ContactsListPanel uses hooks; call it only while a React component is rendering.
  const panel = ContactsListPanel({
    L: defaultContactsLabels,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    viewLabel: "All contacts",
    view: "all",
    selectedGroupId: null,
    selectedIds: [],
    selectionMode: false,
    listLoading,
    listRefreshing,
    visibleCards,
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
    onRefreshList,
  });
  if (slot === "list") return <>{panel.listContent}</>;
  if (slot === "header") return <>{panel.header}</>;
  return (
    <>
      {panel.header}
      {panel.listContent}
    </>
  );
}

function renderListAvatars(visibleCards: ContactCard[]) {
  return render(
    <TooltipProvider>
      <ListHarness visibleCards={visibleCards} slot="list" />
    </TooltipProvider>,
  );
}

describe("ContactsListPanel refresh vs initial load", () => {
  it("keeps existing cards visible while the refresh button is busy", () => {
    render(
      <TooltipProvider>
        <ListHarness visibleCards={[personCard]} listRefreshing onRefreshList={() => {}} />
      </TooltipProvider>,
    );
    expect(
      (screen.getByRole("button", { name: defaultContactsLabels.refreshList }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText(defaultContactsLabels.listLoading)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
  });

  it("shows the list loading spinner only on initial load", () => {
    render(
      <TooltipProvider>
        <ListHarness visibleCards={[personCard]} listLoading />
      </TooltipProvider>,
    );
    expect(screen.getByText(defaultContactsLabels.listLoading)).toBeTruthy();
    expect(screen.queryByText("Jane Doe")).toBeNull();
  });
});

describe("ContactsListPanel avatars", () => {
  it("renders a company icon for org cards and initials for people", () => {
    const { container } = renderListAvatars([orgCard, personCard]);
    const orgRow = container.querySelector('[data-list-item-id="card-acme"]');
    const personRow = container.querySelector('[data-list-item-id="card-jane"]');
    expect(orgRow?.querySelector(".contacts-list-panel__avatar .contacts-org-icon")).toBeTruthy();
    expect(orgRow?.querySelector(".user-avatar__mark")?.textContent).not.toMatch(/A/);
    expect(personRow?.querySelector(".contacts-org-icon")).toBeNull();
    expect(personRow?.querySelector(".user-avatar__mark")?.textContent).toMatch(/J/);
    expect(personRow?.querySelector("img")).toBeNull();
    expect(
      (
        personRow?.querySelector(".contacts-user-avatar") as HTMLElement | null
      )?.style.getPropertyValue("--contacts-book-color"),
    ).toBe(addressBookDotColor({ id: "default" }));
  });

  it("tints list initials from each row's address book", () => {
    const workCard = {
      ...personCard,
      id: "card-joe",
      uid: "urn:uuid:joe",
      name: { full: "Joe Example" },
      addressBookIds: { work: true },
    } as unknown as ContactCard;
    const { container } = renderListAvatars([personCard, workCard]);
    const defaultRow = container.querySelector('[data-list-item-id="card-jane"]');
    const workRow = container.querySelector('[data-list-item-id="card-joe"]');
    expect(
      (
        defaultRow?.querySelector(".contacts-user-avatar") as HTMLElement | null
      )?.style.getPropertyValue("--contacts-book-color"),
    ).toBe(addressBookDotColor({ id: "default" }));
    expect(
      (
        workRow?.querySelector(".contacts-user-avatar") as HTMLElement | null
      )?.style.getPropertyValue("--contacts-book-color"),
    ).toBe(addressBookDotColor({ id: "work" }));
    expect(addressBookDotColor({ id: "work" })).not.toBe(addressBookDotColor({ id: "default" }));
  });

  it("lazy-loads list photo imgs with native loading and decoding", () => {
    const { container } = renderListAvatars([personWithPhoto]);
    const img = container.querySelector(
      '[data-list-item-id="card-photo-jane"] img.user-avatar__image',
    );
    expect(img?.getAttribute("src")).toBe("https://example.com/photos/jane.jpg");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
  });

  it("wraps rows in the shared list reorder animation container", () => {
    const { container } = renderListAvatars([personCard]);
    expect(container.querySelector(".contacts-list-panel__list")).toBeTruthy();
    expect(container.querySelector('[data-list-item-id="card-jane"]')).toBeTruthy();
  });
});
