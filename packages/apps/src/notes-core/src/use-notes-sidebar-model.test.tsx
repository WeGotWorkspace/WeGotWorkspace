import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  collectionsFromNotesData,
  notebookViewKey,
  useNotesSidebarModel,
} from "@/notes-core/src/use-notes-sidebar-model";

describe("useNotesSidebarModel", () => {
  const dropZone = () => ({
    isDropTarget: false,
    onDragEnter: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  });

  it("drops the per-note Shared with me item", () => {
    const { result } = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: "all",
        notebooks: ["Drafts"],
        notebookCollections: [
          { id: "notes-general", name: "General", isSharee: false },
          { id: "shared-nb", name: "Shared Notes", isSharee: true },
        ],
        tags: [],
        selectView: vi.fn(),
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );

    expect(result.current.primarySidebarItems.map((item) => item.label)).toEqual([
      "All Items",
      "Starred",
      "Archived",
    ]);
    expect(result.current.ownedNotebooks.map((item) => item.name)).toEqual(["General"]);
    expect(result.current.sharedNotebooks.map((item) => item.name)).toEqual(["Shared Notes"]);
    expect(notebookViewKey("shared-nb")).toBe("nb:shared-nb");
  });

  it("partitions owned vs shared from collection-sidebar only", () => {
    const collections = collectionsFromNotesData(["Drafts"], [], [
      { id: "a", name: "Alpha", isSharee: false },
      { id: "b", name: "Beta", isSharee: true },
    ]);
    expect(collections).toHaveLength(2);
  });
});
