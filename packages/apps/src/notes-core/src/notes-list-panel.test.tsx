import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Note } from "@/lib/models/note";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

const baseNote: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Hello",
  body: ["Hello"],
  notebook: "Drafts",
  tags: [],
  wordCount: 1,
};

function ListHarness({
  notes,
  selectedIds = [],
  activeId = "",
  view = "all",
  viewLabel = "All Items",
  notebookCollections,
  listLoading = false,
  listRefreshing = false,
  onRefreshList,
  onEditTag,
  slot = "list",
}: {
  notes: Note[];
  selectedIds?: string[];
  activeId?: string;
  view?: string;
  viewLabel?: string;
  notebookCollections?: NotesNotebookCollection[];
  listLoading?: boolean;
  listRefreshing?: boolean;
  onRefreshList?: () => void;
  onEditTag?: () => void;
  slot?: "list" | "header" | "both";
}) {
  const panel = NotesListPanel({
    L: defaultNotesLabels,
    sidebarOpen: true,
    onToggleSidebar: () => {},
    viewLabel,
    selectedIds,
    selectionMode: false,
    listLoading,
    listRefreshing,
    onRefreshList,
    onEditTag,
    visibleNotes: notes,
    notebookCollections,
    searchQuery: "",
    setSearchQuery: () => {},
    searchInputRef: createRef<HTMLInputElement>(),
    view,
    isTouch: false,
    starred: {},
    archived: {},
    activeId,
    isItemDragging: () => false,
    handleSelect: () => {},
    enterSelectionFor: () => {},
    itemDragHandlers: () => ({}),
    openDeleteConfirmForArchive: () => {},
    toggleStar: () => {},
    toggleArchive: () => {},
    selectionBar: null,
  });
  const content =
    slot === "both" ? (
      <>
        {panel.header}
        {panel.listContent}
      </>
    ) : slot === "header" ? (
      panel.header
    ) : (
      panel.listContent
    );
  return <TooltipProvider delayDuration={0}>{content}</TooltipProvider>;
}

describe("NotesListPanel refresh vs initial load", () => {
  it("keeps existing rows visible while the refresh button is busy", () => {
    render(
      <TooltipProvider>
        <ListHarness notes={[baseNote]} listRefreshing onRefreshList={() => {}} slot="both" />
      </TooltipProvider>,
    );
    expect(
      (screen.getByRole("button", { name: defaultNotesLabels.refreshList }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText(defaultNotesLabels.listLoading)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("shows the list loading spinner only on initial load", () => {
    render(
      <TooltipProvider>
        <ListHarness notes={[baseNote]} listLoading slot="both" />
      </TooltipProvider>,
    );
    expect(screen.getByText(defaultNotesLabels.listLoading)).toBeTruthy();
    expect(screen.queryByText("Hello")).toBeNull();
  });
});

describe("NotesListPanel header chrome", () => {
  it("does not show edit or delete notebook controls on the view header", () => {
    render(
      <TooltipProvider>
        <ListHarness notes={[baseNote]} view="nb:notes-drafts" viewLabel="Drafts" slot="header" />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: defaultNotesLabels.edit })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultNotesLabels.remove })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultNotesLabels.deleteNotebook })).toBeNull();
  });

  it("shows Edit tag directly left of refresh on a tag view", async () => {
    const onEditTag = vi.fn();
    render(
      <ListHarness
        notes={[baseNote]}
        view="tag:focus"
        viewLabel="#focus"
        onRefreshList={() => {}}
        onEditTag={onEditTag}
        slot="header"
      />,
    );
    const edit = screen.getByRole("button", { name: defaultNotesLabels.editTag });
    const refresh = screen.getByRole("button", { name: defaultNotesLabels.refreshList });
    expect(edit.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(edit.parentElement?.querySelector("button")).toBe(edit);

    fireEvent.click(edit);
    expect(onEditTag).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(edit, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe(defaultNotesLabels.editTag);
  });

  it("hides Edit tag when the view has no tag to edit", () => {
    render(<ListHarness notes={[baseNote]} onRefreshList={() => {}} slot="header" />);
    expect(screen.queryByRole("button", { name: defaultNotesLabels.editTag })).toBeNull();
    expect(screen.getByRole("button", { name: defaultNotesLabels.refreshList })).toBeTruthy();
  });
});

describe("NotesListPanel notebook labels", () => {
  it("shows the live collection name when the note still has the old name", () => {
    render(
      <ListHarness
        notes={[
          { ...baseNote, id: "n-1", notebook: "Drafts", notebookId: "notes-drafts" },
          { ...baseNote, id: "n-2", notebook: "Work", notebookId: "notes-work" },
        ]}
        notebookCollections={[
          { id: "notes-drafts", name: "Journal" },
          { id: "notes-work", name: "Work" },
        ]}
      />,
    );
    expect(screen.queryByText("Journal")).toBeNull();
    expect(screen.queryByText("Work")).toBeNull();
    expect(screen.queryByText("Drafts")).toBeNull();
    const journal = screen.getByRole("img", { name: "Journal" });
    const work = screen.getByRole("img", { name: "Work" });
    expect(journal.closest(".list-item__meta-trailing")).toBeTruthy();
    expect(work.closest(".list-item__meta-trailing")).toBeTruthy();
    expect(journal.closest(".list-item__subtitle")).toBeNull();
    expect(journal.querySelector(".notes-list-panel__notebook-name")).toBeNull();
  });

  it("shows the notebook name in a tooltip on the icon", async () => {
    render(
      <ListHarness
        notes={[{ ...baseNote, notebook: "Drafts", notebookId: "notes-drafts" }]}
        notebookCollections={[{ id: "notes-drafts", name: "Journal" }]}
      />,
    );
    fireEvent.pointerMove(screen.getByRole("img", { name: "Journal" }), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("Journal");
  });

  it("shows the group collection display name and color, not the group-… slug", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "n-group",
            notebook: "group-administrators",
            notebookId: "group-administrators",
            scope: "group",
            groupSlug: "administrators",
          },
        ]}
        notebookCollections={[
          {
            id: "group-administrators",
            name: "Administratorss",
            color: "#ea8c72",
            scope: "group",
            groupSlug: "administrators",
            isSharee: false,
          },
        ]}
      />,
    );
    expect(screen.queryByText("Administratorss")).toBeNull();
    expect(screen.queryByText("group-administrators")).toBeNull();
    expect(screen.queryByText("administrators")).toBeNull();
    const location = screen.getByRole("img", { name: "Administratorss" });
    expect(location.closest(".list-item__meta-trailing")).toBeTruthy();
    expect(container.querySelector(".notes-list-panel__notebook-name")).toBeNull();
    expect(location).toBeTruthy();
    expect((location as HTMLElement).style.getPropertyValue("--collection-row-color")).toBe(
      "#ea8c72",
    );
    expect(location!.querySelector(".notes-notebook-color-icon")).toBeTruthy();
    expect(location!.querySelector(".collection-sidebar-row__dot")).toBeNull();
    expect(location!.querySelector(".notes-list-panel__notebook-dot")).toBeNull();
  });
});

describe("NotesListPanel selection paint", () => {
  it("does not paint active/selected when selectedIds is empty but activeId is stale", () => {
    const { container } = render(
      <ListHarness notes={[baseNote]} selectedIds={[]} activeId={baseNote.id} />,
    );
    const row = container.querySelector(`[data-list-item-id="${baseNote.id}"]`);
    expect(row).toBeTruthy();
    expect(row!.getAttribute("data-active")).toBe("false");
    expect(row!.getAttribute("data-selected")).toBe("false");
  });

  it("paints the open row when activeId and selectedIds agree", () => {
    const { container } = render(
      <ListHarness notes={[baseNote]} selectedIds={[baseNote.id]} activeId={baseNote.id} />,
    );
    const row = container.querySelector(`[data-list-item-id="${baseNote.id}"]`);
    expect(row!.getAttribute("data-active")).toBe("true");
    expect(row!.getAttribute("data-selected")).toBe("true");
  });

  it("paints each selected note before activeId catches up", () => {
    const second = { ...baseNote, id: "n-2", excerpt: "Second", body: ["Second"] };
    const third = { ...baseNote, id: "n-3", excerpt: "Third", body: ["Third"] };
    const notes = [baseNote, second, third];
    const { container, rerender } = render(
      <ListHarness notes={notes} selectedIds={[baseNote.id]} activeId="" />,
    );
    expect(
      container
        .querySelector(`[data-list-item-id="${baseNote.id}"]`)!
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      container.querySelector(`[data-list-item-id="${baseNote.id}"]`)!.getAttribute("data-active"),
    ).toBe("false");

    rerender(<ListHarness notes={notes} selectedIds={[baseNote.id, second.id]} activeId="" />);
    expect(
      container.querySelector(`[data-list-item-id="${second.id}"]`)!.getAttribute("data-selected"),
    ).toBe("true");
    expect(
      container
        .querySelector("[data-list-selection-mode]")!
        .getAttribute("data-list-selection-mode"),
    ).toBe("true");

    rerender(
      <ListHarness notes={notes} selectedIds={[baseNote.id, second.id, third.id]} activeId="" />,
    );
    expect(
      container.querySelector(`[data-list-item-id="${third.id}"]`)!.getAttribute("data-selected"),
    ).toBe("true");
  });
});

describe("NotesListPanel row placeholders", () => {
  it("reserves a muted empty body when a titled note has no excerpt", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "titled-empty",
            title: "Hallo, hier toch?",
            excerpt: "",
            body: [""],
          },
          {
            ...baseNote,
            id: "titled-body",
            title: "Kunnen we dit nog doen?",
            excerpt: "Vivamus sagittis lacus",
            body: ["Vivamus sagittis lacus"],
          },
        ]}
      />,
    );
    const emptyRow = container.querySelector('[data-list-item-id="titled-empty"]');
    const filledRow = container.querySelector('[data-list-item-id="titled-body"]');
    expect(emptyRow?.querySelector(".list-item__title")?.textContent).toBe("Hallo, hier toch?");
    expect(emptyRow?.querySelector(".list-item__title")?.getAttribute("data-empty")).toBe("false");
    expect(emptyRow?.querySelector(".list-item__body")?.textContent).toBe("Empty item");
    expect(emptyRow?.querySelector(".list-item__body")?.getAttribute("data-empty")).toBe("true");
    expect(filledRow?.querySelector(".list-item__body")?.textContent).toBe(
      "Vivamus sagittis lacus",
    );
    expect(filledRow?.querySelector(".list-item__body")?.getAttribute("data-empty")).toBe("false");
  });

  it("shows an untitled placeholder and still reserves the body line", () => {
    const { container } = render(
      <ListHarness notes={[{ ...baseNote, id: "blank", title: "", excerpt: "", body: [""] }]} />,
    );
    const row = container.querySelector('[data-list-item-id="blank"]');
    const title = row?.querySelector(".list-item__title");
    expect(title?.textContent).toBe("Empty title");
    expect(title?.getAttribute("data-empty")).toBe("true");
    expect(row?.querySelector(".list-item__body")?.textContent).toBe("Empty item");
    expect(row?.querySelector(".list-item__body")?.getAttribute("data-empty")).toBe("true");
  });

  it("keeps an empty title placeholder and shows the excerpt on the body line", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "empty-title",
            title: "",
            excerpt: "Vivamus sagittis lacus vel augue",
            body: ["Vivamus sagittis lacus vel augue"],
          },
        ]}
      />,
    );
    const row = container.querySelector('[data-list-item-id="empty-title"]');
    const title = row?.querySelector(".list-item__title");
    expect(title?.textContent).toBe("Empty title");
    expect(title?.getAttribute("data-empty")).toBe("true");
    expect(title?.textContent).not.toContain("Vivamus");
    expect(row?.querySelector(".list-item__body")?.textContent).toBe(
      "Vivamus sagittis lacus vel augue",
    );
    expect(row?.querySelector(".list-item__body")?.getAttribute("data-empty")).toBe("false");
  });
});

describe("NotesListPanel tags", () => {
  it("does not render tag chips on list rows", () => {
    const { container } = render(
      <ListHarness notes={[{ ...baseNote, tags: ["architecture", "essay", "travel"] }]} />,
    );
    expect(container.querySelector(".list-item__tags")).toBeNull();
    expect(container.querySelector(".tag")).toBeNull();
    expect(screen.queryByText("architecture")).toBeNull();
    expect(screen.queryByText("essay")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });
});

describe("NotesListPanel access chips", () => {
  it("shows a view-only eye icon when mayEditContent is false", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "swm-1",
            sharedInbox: true,
            sharedBy: "bob",
            myRights: { mayEditContent: false },
          },
        ]}
      />,
    );
    const eye = container.querySelector(".notes-list-panel__view-only-pip");
    expect(eye).toBeTruthy();
    expect(eye!.getAttribute("aria-label")).toBe(defaultNotesLabels.viewOnly);
    expect(screen.queryByText(defaultNotesLabels.viewOnly)).toBeNull();
    expect(screen.queryByRole("img", { name: defaultNotesLabels.shared })).toBeNull();
  });

  it("hides view-only eye for edit access and owned notes", () => {
    const { container } = render(
      <ListHarness
        notes={[
          baseNote,
          {
            ...baseNote,
            id: "swm-edit",
            sharedInbox: true,
            sharedBy: "bob",
            myRights: { mayEditContent: true },
          },
        ]}
      />,
    );
    expect(container.querySelector(".notes-list-panel__view-only-pip")).toBeNull();
  });

  it("shows grantor username with Share2 meta like notebook rows", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "swm-1",
            sharedInbox: true,
            sharedBy: "bob",
            myRights: { mayEditContent: true },
          },
        ]}
      />,
    );
    const meta = screen.getByRole("img", { name: "bob" });
    expect(meta.closest(".list-item__meta-trailing")).toBeTruthy();
    expect(screen.queryByText("bob")).toBeNull();
    expect(meta.querySelector(".notes-notebook-color-icon")).toBeTruthy();
    expect(meta.querySelector(".collection-sidebar-row__dot")).toBeNull();
    expect(meta.querySelector(".notes-list-panel__notebook-name")).toBeNull();
    expect(container.querySelector(".notes-list-panel__shared-by-chip")).toBeNull();
    expect(container.querySelector(".tag")).toBeNull();
  });

  it("shows a share icon next to the star cluster for owned outgoing shares", () => {
    const { container } = render(<ListHarness notes={[{ ...baseNote, isShared: true }]} />);
    const sharedPip = container.querySelector(".notes-list-panel__shared-pip");
    expect(sharedPip).toBeTruthy();
    expect(sharedPip!.getAttribute("aria-label")).toBe(defaultNotesLabels.shared);
    expect(screen.queryByText(defaultNotesLabels.shared)).toBeNull();
    expect(container.querySelector(".notes-list-panel__view-only-pip")).toBeNull();
  });

  it("hides share icon on incoming share stubs even when isShared is set", () => {
    const { container } = render(
      <ListHarness
        notes={[
          {
            ...baseNote,
            id: "swm-1",
            sharedInbox: true,
            sharedBy: "bob",
            isShared: true,
            myRights: { mayEditContent: true },
          },
        ]}
      />,
    );
    expect(container.querySelector(".notes-list-panel__shared-pip")).toBeNull();
  });

  it("shows the item count as parenthetical text beside the title", () => {
    const { container } = render(
      <TooltipProvider>
        <ListHarness notes={[baseNote]} slot="header" />
      </TooltipProvider>,
    );
    const count = container.querySelector(".view-header__title-suffix .view-header__title-count");
    expect(count).not.toBeNull();
    expect(count!.getAttribute("aria-label")).toBe(defaultNotesLabels.listItems(1));
    expect(count!.textContent).toBe("(1)");
  });
});
