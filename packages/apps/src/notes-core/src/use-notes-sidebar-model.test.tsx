import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  collectionsFromNotesData,
  isViewOnlyNotebook,
  nextNotesTagView,
  notebookViewKey,
  sharedNotebookFilterKeys,
  tagViewKey,
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
        notebooks: ["General"],
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
    expect(result.current.tagSidebarTags).toEqual([]);
    expect(result.current.showTagsSection).toBe(false);
    expect(notebookViewKey("shared-nb")).toBe("nb:shared-nb");
  });

  it("shows the Tags section only when at least one tag exists", () => {
    const empty = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: "all",
        notebooks: ["General"],
        tags: [],
        selectView: vi.fn(),
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );
    expect(empty.result.current.showTagsSection).toBe(false);
    expect(empty.result.current.tagSidebarTags).toEqual([]);

    const withTags = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: "all",
        notebooks: ["General"],
        tags: ["focus"],
        selectView: vi.fn(),
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );
    expect(withTags.result.current.showTagsSection).toBe(true);
    expect(withTags.result.current.tagSidebarTags.map((entry) => entry.tag)).toEqual(["focus"]);
  });

  it("partitions owned vs shared from collection-sidebar only", () => {
    const collections = collectionsFromNotesData(
      ["Alpha"],
      [],
      [
        { id: "a", name: "Alpha", isSharee: false },
        { id: "b", name: "Beta", isSharee: true },
      ],
    );
    expect(collections).toHaveLength(2);
  });

  it("keeps group membership in My notebooks and inbound ACL under Shared with me", () => {
    const { result } = renderHook(() =>
      useNotesSidebarModel({
        labels: defaultNotesLabels,
        view: "all",
        notebooks: ["General"],
        sharedNotebooks: [
          {
            path: "/groups/eng/.notes/Specs",
            notebook: "Specs",
            owner: "eng",
            scope: "group",
            groupSlug: "eng",
          },
        ],
        notebookCollections: [
          { id: "notes-general", name: "General", isSharee: false },
          { id: "group-eng", name: "Specs", isSharee: false, scope: "group" },
          {
            id: "shared-nb",
            name: "Shared Notes",
            isSharee: true,
            myRights: { mayWriteAll: false },
          },
        ],
        tags: [],
        selectView: vi.fn(),
        sidebarDropZoneProps: () => dropZone(),
        moveToNotebook: vi.fn(),
        assignTagToNotes: vi.fn(),
      }),
    );

    expect(result.current.ownedNotebooks.map((item) => item.name)).toEqual(["General", "Specs"]);
    expect(result.current.sharedNotebooks.map((item) => item.name)).toEqual(["Shared Notes"]);
    expect(isViewOnlyNotebook(result.current.sharedNotebooks[0]!)).toBe(true);
    expect(isViewOnlyNotebook(result.current.ownedNotebooks[0]!)).toBe(false);
    expect([...sharedNotebookFilterKeys(result.current.sharedNotebooks)]).toEqual(
      expect.arrayContaining(["shared-nb", "Shared Notes"]),
    );
  });

  it("maps leftover group sharedNotebooks as owned, not Shared with me", () => {
    const collections = collectionsFromNotesData(
      ["General"],
      [
        {
          path: "/groups/eng/.notes/Specs",
          notebook: "Specs",
          owner: "eng",
          scope: "group",
          groupSlug: "eng",
        },
      ],
    );
    expect(collections.map((item) => ({ name: item.name, isSharee: item.isSharee }))).toEqual([
      { name: "General", isSharee: false },
      { name: "Specs", isSharee: false },
    ]);
  });

  it("keeps leftover sibling notebooks when collections is a single created row", () => {
    const collections = collectionsFromNotesData(
      ["General", "Drafts"],
      [],
      [{ id: "notes-ideas", name: "Ideas", color: "#ec4899", isSharee: false }],
    );
    expect(collections.map((item) => item.name)).toEqual(["Ideas", "General", "Drafts"]);
    expect(collections.find((item) => item.name === "Ideas")?.color).toBe("#ec4899");
  });

  it("toggles the active tag back to All Items and selects a different tag", () => {
    expect(tagViewKey("focus")).toBe("tag:focus");
    expect(nextNotesTagView("all", "focus")).toBe("tag:focus");
    expect(nextNotesTagView("tag:focus", "focus")).toBe("all");
    expect(nextNotesTagView("tag:focus", "work")).toBe("tag:work");
    expect(nextNotesTagView("nb:notes-general", "focus")).toBe("tag:focus");

    const selectView = vi.fn();
    const { result, rerender } = renderHook(
      ({ view }: { view: string }) =>
        useNotesSidebarModel({
          labels: defaultNotesLabels,
          view,
          notebooks: ["General"],
          tags: ["focus", "work"],
          selectView,
          sidebarDropZoneProps: () => dropZone(),
          moveToNotebook: vi.fn(),
          assignTagToNotes: vi.fn(),
        }),
      { initialProps: { view: "all" } },
    );

    const focus = result.current.tagSidebarTags.find((entry) => entry.tag === "focus")!;
    expect(focus.selected).toBe(false);
    focus.onSelect();
    expect(selectView).toHaveBeenCalledWith("tag:focus");

    selectView.mockClear();
    rerender({ view: "tag:focus" });
    const selectedFocus = result.current.tagSidebarTags.find((entry) => entry.tag === "focus")!;
    const work = result.current.tagSidebarTags.find((entry) => entry.tag === "work")!;
    expect(selectedFocus.selected).toBe(true);
    expect(work.selected).toBe(false);

    selectedFocus.onSelect();
    expect(selectView).toHaveBeenCalledWith("all");

    selectView.mockClear();
    work.onSelect();
    expect(selectView).toHaveBeenCalledWith("tag:work");
  });
});
