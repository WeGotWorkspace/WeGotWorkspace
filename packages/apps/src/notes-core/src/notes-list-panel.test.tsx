import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Note } from "@/lib/models/note";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";

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

function ListHarness({ notes }: { notes: Note[] }) {
  const panel = NotesListPanel({
    L: defaultNotesLabels,
    sidebarOpen: true,
    onToggleSidebar: () => {},
    viewLabel: "All Items",
    selectedIds: [],
    selectionMode: false,
    listLoading: false,
    visibleNotes: notes,
    searchQuery: "",
    setSearchQuery: () => {},
    searchInputRef: createRef<HTMLInputElement>(),
    canEditDelete: false,
    selectedNotebook: null,
    selectedTag: null,
    view: "all",
    isTouch: false,
    starred: {},
    archived: {},
    activeId: "",
    isItemDragging: () => false,
    handleSelect: () => {},
    enterSelectionFor: () => {},
    itemDragHandlers: () => ({}),
    openEditDialog: () => {},
    openDeleteDialog: () => {},
    openDeleteConfirmForArchive: () => {},
    toggleStar: () => {},
    toggleArchive: () => {},
    selectionBar: null,
  });
  return <>{panel.listContent}</>;
}

describe("NotesListPanel access chips", () => {
  it("shows View only when mayEditContent is false", () => {
    render(
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
    expect(screen.getByText(defaultNotesLabels.viewOnly)).toBeTruthy();
    expect(screen.queryByRole("img", { name: defaultNotesLabels.shared })).toBeNull();
  });

  it("hides View only for edit access and owned notes", () => {
    render(
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
    expect(screen.queryByText(defaultNotesLabels.viewOnly)).toBeNull();
  });

  it("shows a share icon next to the star cluster for owned outgoing shares", () => {
    const { container } = render(<ListHarness notes={[{ ...baseNote, isShared: true }]} />);
    const sharedPip = container.querySelector(".notes-list-panel__shared-pip");
    expect(sharedPip).toBeTruthy();
    expect(sharedPip!.getAttribute("aria-label")).toBe(defaultNotesLabels.shared);
    expect(
      container.querySelector(".notes-list-panel__notebook .notes-list-panel__access-chip"),
    ).toBeNull();
    expect(screen.queryByText(defaultNotesLabels.shared)).toBeNull();
    expect(screen.queryByText(defaultNotesLabels.viewOnly)).toBeNull();
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

  it("renders View only as a tag chip", () => {
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
    const viewOnlyChip = container.querySelector(".notes-list-panel__access-chip.tag");
    expect(viewOnlyChip).toBeTruthy();
    expect(viewOnlyChip!.textContent).toContain(defaultNotesLabels.viewOnly);
  });
});
