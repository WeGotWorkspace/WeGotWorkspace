import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { BookOpen, Users } from "lucide-react";
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
        notebook: "General",
        owner: "administrators",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe("administrators");
  });

  it("lists personal + group notebooks under Notebooks (Users icon for groups)", () => {
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
          // Personal ACL notebook-dir shares are ignored.
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
      "administrators",
      "eng",
    ]);

    const drafts = result.current.notebookSidebarItems.find((item) => item.label === "Drafts");
    const groupItem = result.current.notebookSidebarItems.find(
      (item) => item.label === "administrators",
    );
    expect(isValidElement(drafts?.icon) && drafts?.icon.type).toBe(BookOpen);
    expect(isValidElement(groupItem?.icon) && groupItem?.icon.type).toBe(Users);
    expect(groupItem?.description).toBeUndefined();

    result.current.primarySidebarItems[3]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith("shared-with-me");

    result.current.notebookSidebarItems.find((item) => item.label === "eng")?.onClick?.();
    expect(selectView).toHaveBeenCalledWith(sharedNotebookViewKey("/groups/eng/.notes/Specs"));
  });

  it("selects the active group notebook view under Notebooks", () => {
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

    const groupItem = result.current.notebookSidebarItems.find((item) => item.label === "eng");
    const drafts = result.current.notebookSidebarItems.find((item) => item.label === "Drafts");
    expect(groupItem?.selected).toBe(true);
    expect(drafts?.selected).toBe(false);
  });
});
