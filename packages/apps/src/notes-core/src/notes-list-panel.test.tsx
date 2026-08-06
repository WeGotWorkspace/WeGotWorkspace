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

  it("shows grantor username as a tag chip on shared-inbox rows", () => {
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
    const chip = container.querySelector(".notes-list-panel__shared-by-chip.tag");
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain("bob");
    expect(chip!.textContent).not.toContain("Shared by");
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
