import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  sharedNotebookLabel,
  sharedNotebookViewKey,
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

  it("labels group notebooks with the group name only", () => {
    expect(
      sharedNotebookLabel({
        path: "/groups/administrators/.notes/General",
        notebook: "General",
        owner: "administrators",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe("administrators");
    expect(
      sharedNotebookLabel({
        path: "/users/bob/.notes/TeamPad",
        notebook: "TeamPad",
        owner: "bob",
        scope: "personal",
        groupSlug: null,
      }),
    ).toBe("TeamPad");
  });

  it("includes Shared with me in primary nav and splits personal vs shared notebooks", () => {
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: "all",
        notebooks: ["Drafts", "Journal"],
        sharedNotebooks: [
          {
            path: "/groups/eng/.notes/Specs",
            notebook: "Specs",
            owner: "eng",
            scope: "group",
            groupSlug: "eng",
          },
          {
            path: "/groups/administrators/.notes/General",
            notebook: "General",
            owner: "administrators",
            scope: "group",
            groupSlug: "administrators",
          },
          {
            path: "/users/bob/.notes/TeamPad",
            notebook: "TeamPad",
            owner: "bob",
            scope: "personal",
            groupSlug: null,
            access: "edit",
          },
        ],
        tags: ["focus"],
        selectView,
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );

    expect(result.current.primarySidebarItems.map((item) => item.label)).toEqual([
      "All Items",
      "Starred",
      "Archived",
      "Shared with me",
    ]);
    expect(result.current.notebookSidebarItems.map((item) => item.label)).toEqual([
      "Drafts",
      "Journal",
    ]);
    expect(result.current.sharedNotebookSidebarItems.map((item) => item.label)).toEqual([
      "administrators",
      "eng",
      "TeamPad",
    ]);
    expect(
      result.current.sharedNotebookSidebarItems.find((item) => item.label === "administrators")
        ?.description,
    ).toBeUndefined();
    expect(
      result.current.sharedNotebookSidebarItems.find((item) => item.label === "TeamPad")
        ?.description,
    ).toBe("bob");

    result.current.primarySidebarItems[3]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith("shared-with-me");

    result.current.sharedNotebookSidebarItems.find((item) => item.label === "TeamPad")?.onClick?.();
    expect(selectView).toHaveBeenCalledWith(sharedNotebookViewKey("/users/bob/.notes/TeamPad"));
  });

  it("selects the active shared notebook view", () => {
    const viewKey = sharedNotebookViewKey("/groups/eng/.notes/Specs");
    const { result } = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: viewKey,
        notebooks: ["Drafts"],
        sharedNotebooks: [
          {
            path: "/groups/eng/.notes/Specs",
            notebook: "Specs",
            owner: "eng",
            scope: "group",
            groupSlug: "eng",
          },
        ],
        tags: [],
        selectView: vi.fn(),
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );

    expect(result.current.sharedNotebookSidebarItems[0]?.selected).toBe(true);
    expect(result.current.notebookSidebarItems[0]?.selected).toBe(false);
  });
});
