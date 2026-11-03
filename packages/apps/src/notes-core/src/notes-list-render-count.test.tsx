import { createRef, useEffect, useMemo, useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Note } from "@/lib/models/note";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { syncNoteFlagMap, type NoteFlagMap } from "@/notes-core/src/notes-flag-map";
import { filterVisibleNotes, mapNotesWithBodyMarkdown } from "@/notes-core/src/notes-note-utils";
import { TooltipProvider } from "@/ui/tooltip";

// #1714: one changed note must render one list row, not all of them.
const renderedRowIds: string[] = [];

vi.mock("@/list-item/src/list-item", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/list-item/src/list-item")>();
  function CountingListItem(props: ComponentProps<typeof actual.ListItem>) {
    renderedRowIds.push(props.id);
    return actual.ListItem(props);
  }
  return { ...actual, ListItem: CountingListItem };
});

const NOTE_COUNT = 1000;

function makeNotes(): Note[] {
  return Array.from({ length: NOTE_COUNT }, (_, index) => ({
    id: `n-${index}`,
    category: "Note",
    title: `Note ${index}`,
    // Oldest last, so the list order matches the index.
    date: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
    excerpt: `Body ${index}`,
    body: [`Body ${index}`],
    notebook: "Drafts",
    tags: [],
    wordCount: 2,
    ...(index % 7 === 0 ? { starred: true } : {}),
  }));
}

let setNotesFromTest: (update: (prev: Note[]) => Note[]) => void = () => {};

/** The workspace's list wiring: notes state → flags → visible notes → panel. */
function NotesListHarness({ initialNotes }: { initialNotes: Note[] }) {
  const [notes, setNotes] = useState(initialNotes);
  setNotesFromTest = setNotes;
  const [starred, setStarred] = useState<NoteFlagMap>({});
  const [archived, setArchived] = useState<NoteFlagMap>({});
  useEffect(() => setStarred(syncNoteFlagMap(notes, "starred")), [notes]);
  useEffect(() => setArchived(syncNoteFlagMap(notes, "archived")), [notes]);
  const visibleNotes = useMemo(
    () => filterVisibleNotes(notes, { view: "all", archived, starred, searchQuery: "" }),
    [archived, notes, starred],
  );
  const panel = NotesListPanel({
    L: defaultNotesLabels,
    sidebarOpen: true,
    onToggleSidebar: () => {},
    viewLabel: "All Items",
    selectedIds: [],
    selectionMode: false,
    listLoading: false,
    visibleNotes,
    searchQuery: "",
    setSearchQuery: () => {},
    searchInputRef: createRef<HTMLInputElement>(),
    view: "all",
    isTouch: false,
    starred,
    archived,
    activeId: "",
    isItemDragging: () => false,
    handleSelect: () => {},
    enterSelectionFor: () => {},
    itemDragHandlers: () => ({}),
    openDeleteConfirmForArchive: () => {},
    // New identities every render, like the controller's callbacks.
    toggleStar: () => {},
    toggleArchive: () => {},
    selectionBar: null,
  });
  return <TooltipProvider>{panel.listContent}</TooltipProvider>;
}

beforeEach(() => {
  renderedRowIds.length = 0;
  // The reorder animation asks for reduced motion; jsdom has no matchMedia.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("notes list with 1000 notes", () => {
  it("keeps every other note object when one body changes", () => {
    const notes = makeNotes();
    const { notes: next, updated } = mapNotesWithBodyMarkdown(notes, "n-500", "Typed text");

    expect(updated?.id).toBe("n-500");
    expect(next).not.toBe(notes);
    next.forEach((note, index) => {
      if (note.id === "n-500") expect(note).not.toBe(notes[index]);
      else expect(note).toBe(notes[index]);
    });
  });

  it("renders one row when one note's body changes", () => {
    render(<NotesListHarness initialNotes={makeNotes()} />);
    expect(renderedRowIds.length).toBeGreaterThanOrEqual(NOTE_COUNT);

    renderedRowIds.length = 0;
    act(() => {
      setNotesFromTest(
        (prev) => mapNotesWithBodyMarkdown(prev, "n-500", "Typed text", { bumpDate: false }).notes,
      );
    });

    expect(renderedRowIds).toEqual(["n-500"]);
  });

  it("renders one row when the edited note moves to the top", () => {
    render(<NotesListHarness initialNotes={makeNotes()} />);

    renderedRowIds.length = 0;
    act(() => {
      setNotesFromTest(
        (prev) =>
          mapNotesWithBodyMarkdown(prev, "n-500", "Typed text", {
            editedAt: "2026-02-01T00:00:00.000Z",
          }).notes,
      );
    });

    expect(renderedRowIds).toEqual(["n-500"]);
  });
});
