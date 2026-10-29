import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsListPanel } from "./contacts-list-panel";
import { defaultContactsLabels } from "./contacts-labels";
import { contactListRowOffset, flattenContactListRows } from "./contacts-list-window";
import type { ContactCard } from "./contacts-types";

const reorderIds = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-list-reorder-animation", () => ({
  useListReorderAnimation: (_ref: unknown, ids: readonly string[]) => {
    reorderIds(ids);
  },
}));

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
  downloadTotal,
  selectedIds = [],
}: {
  visibleCards: ContactCard[];
  listLoading?: boolean;
  listRefreshing?: boolean;
  onRefreshList?: () => void;
  slot?: "list" | "header" | "both";
  downloadTotal?: number;
  selectedIds?: string[];
}) {
  // ContactsListPanel uses hooks; call it only while a React component is rendering.
  const panel = ContactsListPanel({
    L: defaultContactsLabels,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    viewLabel: "All contacts",
    view: "all",
    selectedGroupId: null,
    selectedIds,
    selectionMode: selectedIds.length > 1,
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
    downloadTotal,
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

function EmptyListHarness({ view = "all" }: { view?: string }) {
  const panel = ContactsListPanel({
    L: defaultContactsLabels,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    viewLabel: "All contacts",
    view,
    selectedGroupId: null,
    selectedIds: [],
    selectionMode: false,
    listLoading: false,
    visibleCards: [],
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
  return <CollectionListWorkspace {...panel} />;
}

describe("ContactsListPanel empty state", () => {
  it("shows the contacts icon above the no-contacts label", () => {
    const { container } = render(
      <TooltipProvider>
        <EmptyListHarness />
      </TooltipProvider>,
    );
    const state = container.querySelector(".collection-state");
    const icon = state?.querySelector(".collection-state__icon");
    expect(icon?.querySelector("svg.lucide-users")).toBeTruthy();
    expect(state?.querySelector(".collection-state__body")?.textContent).toBe(
      defaultContactsLabels.emptyList,
    );
    expect(container.querySelector(".collection-state-host")).toBeTruthy();
    expect(container.querySelector(".collection-empty-state")).toBeNull();
  });
});

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

describe("ContactsListPanel header count", () => {
  function headerCount(): string | null | undefined {
    return document.querySelector(".view-header__title-count")?.textContent;
  }

  it("counts the cards still downloading, not only the rows loaded so far", () => {
    render(
      <TooltipProvider>
        <ListHarness visibleCards={[personCard, orgCard]} downloadTotal={1000} slot="header" />
      </TooltipProvider>,
    );
    expect(headerCount()).toBe("(1000)");
    expect(screen.getByLabelText(defaultContactsLabels.listContacts(1000))).toBeTruthy();
  });

  it("shows the visible rows once nothing is downloading", () => {
    render(
      <TooltipProvider>
        <ListHarness visibleCards={[personCard, orgCard]} slot="header" />
      </TooltipProvider>,
    );
    expect(headerCount()).toBe("(2)");
  });

  it("keeps the selected count while cards are still downloading", () => {
    render(
      <TooltipProvider>
        <ListHarness
          visibleCards={[personCard, orgCard]}
          selectedIds={[personCard.id, orgCard.id]}
          downloadTotal={1000}
          slot="header"
        />
      </TooltipProvider>,
    );
    expect(headerCount()).toBe("(2)");
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
    ).toBe("");
  });

  it("does not wash list initials with each row's address book", () => {
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
    ).toBe("");
    expect(
      (
        workRow?.querySelector(".contacts-user-avatar") as HTMLElement | null
      )?.style.getPropertyValue("--contacts-book-color"),
    ).toBe("");
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

describe("ContactsListPanel header count", () => {
  it("shows the contact count as parenthetical text beside the title", () => {
    const { container } = render(
      <TooltipProvider>
        <ListHarness visibleCards={[personCard, orgCard]} slot="header" />
      </TooltipProvider>,
    );
    const count = container.querySelector(".view-header__title-suffix .view-header__title-count");
    expect(count).not.toBeNull();
    expect(count!.getAttribute("aria-label")).toBe(defaultContactsLabels.listContacts(2));
    expect(count!.textContent).toBe("(2)");
  });
});

function personAt(index: number): ContactCard {
  return {
    "@type": "Card",
    version: "1.0",
    id: `card-${index}`,
    uid: `urn:uuid:card-${index}`,
    kind: "individual",
    name: {
      full: `Contact${index} Person`,
      components: [
        { kind: "given", value: `Contact${index}` },
        { kind: "surname", value: "Person" },
      ],
    },
    addressBookIds: { default: true },
  } as unknown as ContactCard;
}

function spyScrollIntoView() {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => undefined;
  }
  return vi.spyOn(Element.prototype, "scrollIntoView");
}

function WindowHarness({
  cards,
  activeId,
  scrollerRef,
  listLoading = false,
}: {
  cards: ContactCard[];
  activeId: string;
  scrollerRef: (node: HTMLDivElement | null) => void;
  listLoading?: boolean;
}) {
  const panel = WindowPanel({ cards, activeId, listLoading });
  return (
    <div ref={scrollerRef} className="contacts-list-scroller">
      {panel.listContent}
    </div>
  );
}

/** Calls the panel hook; only use while a React component is rendering. */
function WindowPanel({
  cards,
  activeId = "",
  listLoading = false,
}: {
  cards: ContactCard[];
  activeId?: string;
  listLoading?: boolean;
}) {
  return ContactsListPanel({
    L: defaultContactsLabels,
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    viewLabel: "All contacts",
    view: "all",
    selectedGroupId: null,
    selectedIds: [],
    selectionMode: false,
    listLoading,
    visibleCards: cards,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchInputRef: createRef<HTMLInputElement>(),
    isTouch: false,
    activeId,
    isItemDragging: () => false,
    handleSelect: vi.fn(),
    enterSelectionFor: vi.fn(),
    itemDragHandlers: () => ({}),
    onSwipeDelete: vi.fn(),
    onSwipeRemoveFromGroup: vi.fn(),
    selectionBar: null,
  });
}

describe("ContactsListPanel window", () => {
  const cards = Array.from({ length: 120 }, (_, index) => personAt(index));

  /** Id of the first card row painted at `scrollTop`. */
  function cardIdAt(scrollTop: number): string {
    const rows = flattenContactListRows(cards);
    const index = rows.findIndex((_, i) => contactListRowOffset(rows, i + 1) > scrollTop);
    const row = rows[index];
    if (row?.kind !== "card") throw new Error(`no card row at ${scrollTop}`);
    return row.card.id;
  }

  function mount(activeId: string) {
    const holder: { current: HTMLDivElement | null } = { current: null };
    const view = render(
      <TooltipProvider>
        <WindowHarness
          cards={cards}
          activeId={activeId}
          scrollerRef={(node) => {
            holder.current = node;
            if (!node) return;
            Object.defineProperty(node, "clientHeight", { configurable: true, value: 400 });
          }}
        />
      </TooltipProvider>,
    );
    const scroller = holder.current;
    if (!scroller) throw new Error("scroller missing");
    return { scroller, ...view };
  }

  it("does not scroll the active row back into view when the window moves", () => {
    const scrollIntoView = spyScrollIntoView();
    const { scroller } = mount("card-0");
    scrollIntoView.mockClear();

    act(() => {
      scroller.scrollTop = 4000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(scroller.scrollTop).toBe(4000);
    expect(scrollIntoView).not.toHaveBeenCalled();
    const labelledBy = scroller.querySelector("section")?.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("contacts-section-P");
    expect(scroller.querySelector(`#${labelledBy}`)).toBeTruthy();
    scrollIntoView.mockRestore();
  });

  it("scrolls an off-screen row into view when the selection changes", () => {
    const scrollIntoView = spyScrollIntoView();
    const { scroller, rerender } = mount("card-0");
    act(() => {
      scroller.scrollTop = 4000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    scrollIntoView.mockClear();

    rerender(
      <TooltipProvider>
        <WindowHarness
          cards={cards}
          activeId="card-119"
          scrollerRef={(node) => {
            if (!node) return;
            Object.defineProperty(node, "clientHeight", { configurable: true, value: 400 });
          }}
        />
      </TooltipProvider>,
    );

    const rows = flattenContactListRows(cards);
    const index = rows.findIndex((row) => row.kind === "card" && row.card.id === "card-119");
    expect(scroller.scrollTop).toBe(contactListRowOffset(rows, index));
    expect(scrollIntoView).toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("keeps windowing on scroll when rows arrive before the spinner clears", () => {
    // First visit: cards land while the spinner still shows, so the list
    // element mounts on a later render with the same row count.
    const holder: { current: HTMLDivElement | null } = { current: null };
    const scrollerRef = (node: HTMLDivElement | null) => {
      holder.current = node;
      if (!node) return;
      Object.defineProperty(node, "clientHeight", { configurable: true, value: 400 });
    };
    const { rerender } = render(
      <TooltipProvider>
        <WindowHarness cards={cards} activeId="" scrollerRef={scrollerRef} listLoading />
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <WindowHarness cards={cards} activeId="" scrollerRef={scrollerRef} />
      </TooltipProvider>,
    );
    const scroller = holder.current;
    if (!scroller) throw new Error("scroller missing");

    act(() => {
      scroller.scrollTop = 4000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(scroller.querySelector(`[data-list-item-id="${cardIdAt(4000)}"]`)).toBeTruthy();
  });

  it("keeps windowing on scroll when the scroller remounts with the same rows", () => {
    // Live first visit: the import drop zone appears once the cold download
    // unlocks, which wraps and remounts the scroller with an unchanged row count.
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(400);
    const dropZone = {
      active: false,
      overlay: null,
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
    };
    function Workspace({ withDropZone }: { withDropZone: boolean }) {
      const panel = WindowPanel({ cards });
      return <CollectionListWorkspace {...panel} dropZone={withDropZone ? dropZone : undefined} />;
    }
    const { container, rerender } = render(
      <TooltipProvider>
        <Workspace withDropZone={false} />
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <Workspace withDropZone />
      </TooltipProvider>,
    );
    const scroller = container.querySelector<HTMLElement>(
      ".collection-list-drop-zone .notes-swipe-list",
    );
    if (!scroller) throw new Error("scroller missing");

    act(() => {
      scroller.scrollTop = 4000;
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(scroller.querySelector(`[data-list-item-id="${cardIdAt(4000)}"]`)).toBeTruthy();
    clientHeight.mockRestore();
  });

  it("animates from the full visible id list, not the mounted window", () => {
    reorderIds.mockClear();
    mount("card-0");
    const ids = reorderIds.mock.calls.at(-1)?.[0] as string[];
    expect(ids).toHaveLength(cards.length);
    expect(ids[0]).toBe("card-0");
    expect(ids.at(-1)).toBe("card-119");
  });
});
