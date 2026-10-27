import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { useArchivedNoteFollowsView } from "./use-archived-note-follows-view";

const note = (id: string, archived = false): Note => ({
  id,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "General",
  tags: [],
  wordCount: 0,
  archived,
});

type Props = Parameters<typeof useArchivedNoteFollowsView>[0];

function renderFollow(initial: Omit<Props, "setView">) {
  const setView = vi.fn();
  const hook = renderHook(
    (props: Omit<Props, "setView">) => useArchivedNoteFollowsView({ ...props, setView }),
    { initialProps: initial },
  );
  return { ...hook, setView };
}

describe("useArchivedNoteFollowsView (#1531)", () => {
  it("moves an archived note opened from /notes/all to the Archived view", () => {
    const { setView } = renderFollow({
      serverNotes: [note("a", true)],
      activeId: "a",
      archived: { a: true },
      view: "all",
    });

    expect(setView).toHaveBeenCalledWith("archive");
  });

  it("moves the open note when another tab archives it, without a reload", () => {
    const { setView, rerender } = renderFollow({
      serverNotes: [note("a")],
      activeId: "a",
      archived: {},
      view: "tag:essay",
    });
    expect(setView).not.toHaveBeenCalled();

    rerender({
      serverNotes: [note("a", true)],
      activeId: "a",
      archived: { a: true },
      view: "tag:essay",
    });

    expect(setView).toHaveBeenCalledWith("archive");
  });

  it("does not move for an archive made in this tab that is not saved yet", () => {
    const { setView } = renderFollow({
      serverNotes: [note("a")],
      activeId: "a",
      archived: { a: true },
      view: "all",
    });

    expect(setView).not.toHaveBeenCalled();
  });

  it("stays put in the Archived view and with no note open", () => {
    const inArchive = renderFollow({
      serverNotes: [note("a", true)],
      activeId: "a",
      archived: { a: true },
      view: "archive",
    });
    const nothingOpen = renderFollow({
      serverNotes: [note("a", true)],
      activeId: "",
      archived: { a: true },
      view: "all",
    });

    expect(inArchive.setView).not.toHaveBeenCalled();
    expect(nothingOpen.setView).not.toHaveBeenCalled();
  });
});
