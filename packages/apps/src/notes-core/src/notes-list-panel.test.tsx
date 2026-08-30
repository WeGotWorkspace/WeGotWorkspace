import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  slot = "list",
}: {
  notes: Note[];
  selectedIds?: string[];
  activeId?: string;
  view?: string;
  viewLabel?: string;
  notebookCollections?: NotesNotebookCollection[];
  slot?: "list" | "header";
}) {
  const panel = NotesListPanel({
    L: defaultNotesLabels,
    sidebarOpen: true,
    onToggleSidebar: () => {},
    viewLabel,
    selectedIds,
    selectionMode: false,
    listLoading: false,
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
  return <>{slot === "header" ? panel.header : panel.listContent}</>;
}

describe("NotesListPanel header chrome", () => {
  it("does not show edit or delete notebook controls on the view header", () => {
    render(
      <TooltipProvider>
        <ListHarness
          notes={[baseNote]}
          view="nb:notes-drafts"
          viewLabel="Drafts"
          slot="header"
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: defaultNotesLabels.edit })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultNotesLabels.remove })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultNotesLabels.deleteNotebook })).toBeNull();
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
    expect(screen.getByText("Journal")).toBeTruthy();
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.queryByText("Drafts")).toBeNull();
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
    const meta = container.querySelector(".notes-list-panel__notebook");
    expect(meta).toBeTruthy();
    expect(meta!.querySelector(".collection-sidebar-row__dot")).toBeTruthy();
    expect(meta!.querySelector(".notes-list-panel__notebook-name")?.textContent).toBe("bob");
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
});
