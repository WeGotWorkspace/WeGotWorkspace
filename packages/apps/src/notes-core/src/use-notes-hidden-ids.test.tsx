import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTES_VIEW_PREFS_STORAGE_KEY } from "@/notes-core/src/notes-view-prefs";
import { useNotesHiddenIds } from "@/notes-core/src/use-notes-hidden-ids";

const baseNotebooks = [
  { id: "drafts", name: "Drafts" },
  { id: "work", name: "Work" },
  { id: "shared", name: "Shared", isVisible: false },
];

describe("useNotesHiddenIds", () => {
  beforeEach(() => {
    window.localStorage.removeItem(NOTES_VIEW_PREFS_STORAGE_KEY);
  });

  it("keeps a server-default-hidden notebook visible after the user un-hides it", () => {
    const first = renderHook(() => useNotesHiddenIds(baseNotebooks));
    expect(first.result.current.hiddenNotebookIds.has("shared")).toBe(true);

    act(() => {
      first.result.current.setHiddenNotebookIds(new Set());
    });
    expect(first.result.current.hiddenNotebookIds.has("shared")).toBe(false);
    first.unmount();

    const second = renderHook(() => useNotesHiddenIds(baseNotebooks));
    expect(second.result.current.hiddenNotebookIds.has("shared")).toBe(false);
  });

  it("hides a newly arrived server-default-hidden notebook without a remount", () => {
    const { result, rerender } = renderHook(({ notebooks }) => useNotesHiddenIds(notebooks), {
      initialProps: { notebooks: baseNotebooks },
    });

    rerender({
      notebooks: [...baseNotebooks, { id: "archive", name: "Archive", isVisible: false }],
    });

    expect(result.current.hiddenNotebookIds.has("archive")).toBe(true);
  });
});
