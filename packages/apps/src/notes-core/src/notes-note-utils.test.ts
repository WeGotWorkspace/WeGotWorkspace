import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_WRITE_DEBOUNCE_MS,
  applyNoteBodyMarkdown,
  backfillNotesContentFromServer,
  computeExcerpt,
  computeWordCount,
  createNoteSaveDebouncer,
  enrichNote,
  filterVisibleNotes,
  normalizeTag,
  noteHasListableBody,
  noteListTagOverflow,
  noteListTitle,
  plainTextFromBody,
} from "./notes-note-utils";
import type { Note } from "@/lib/models/note";

const sampleNote: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Hello excerpt",
  body: ["# Title", "Some **bold** text here."],
  notebook: "Drafts",
  tags: ["work"],
  wordCount: 0,
};

describe("notes-note-utils", () => {
  it("normalizes tags by trimming whitespace", () => {
    expect(normalizeTag("  focus  ")).toBe("focus");
  });

  it("computes plain text and word count from markdown body", () => {
    expect(plainTextFromBody(sampleNote.body)).toContain("Title");
    expect(computeWordCount(sampleNote.body)).toBeGreaterThan(0);
  });

  it("truncates long excerpts", () => {
    const longBody = ["x".repeat(200)];
    expect(computeExcerpt(longBody).endsWith("…")).toBe(true);
  });

  it("derives list titles from excerpt or body", () => {
    expect(noteListTitle({ excerpt: "Preview line", body: [""] })).toBe("Preview line");
    expect(noteListTitle({ excerpt: "", body: ["Body line one"] })).toBe("Body line one");
    expect(noteListTitle({ excerpt: "", body: [""] })).toBe("Untitled note");
  });

  it("caps visible list tags and reports overflow", () => {
    expect(noteListTagOverflow(["a", "b"])).toEqual({ visible: ["a", "b"], overflow: 0 });
    expect(noteListTagOverflow(["a", "b", "c", "d"])).toEqual({
      visible: ["a", "b"],
      overflow: 2,
    });
    expect(noteListTagOverflow(["  focus  ", ""])).toEqual({ visible: ["focus"], overflow: 0 });
  });

  it("does not render Untitled when title/excerpt are empty but body has text", () => {
    // Historical rows: frontmatter title was "Untitled", excerpt never backfilled,
    // but the markdown body already has content (e.g. n1781784157-style).
    const stale: Pick<Note, "excerpt" | "body"> = {
      excerpt: "",
      body: [
        "Donec ullamcorper nulla non metus auctor fringilla. Donec ullamcorper nulla non metus auctor fringilla.",
      ],
    };
    expect(noteListTitle(stale)).toMatch(/^Donec ullamcorper/);
    expect(noteListTitle(stale)).not.toBe("Untitled note");

    const enriched = enrichNote({
      ...sampleNote,
      excerpt: "",
      body: stale.body,
      wordCount: 0,
    });
    expect(enriched.excerpt).toMatch(/Donec ullamcorper/);
    expect(noteListTitle(enriched)).toMatch(/^Donec ullamcorper/);
  });

  it("enriches notes with excerpt and word count", () => {
    const enriched = enrichNote({ ...sampleNote, excerpt: "", wordCount: 0 });
    expect(enriched.excerpt.length).toBeGreaterThan(0);
    expect(enriched.wordCount).toBeGreaterThan(0);
  });

  it("backfills empty local body/excerpt from server without dropping local metadata", () => {
    const local: Note = {
      ...sampleNote,
      id: "n1781784184",
      excerpt: "",
      body: [""],
      tags: ["local-tag"],
      starred: true,
      wordCount: 0,
    };
    const server: Note = {
      ...sampleNote,
      id: "n1781784184",
      excerpt: "Donec ullamcorper nulla non metus auctor fringilla.",
      body: ["Donec ullamcorper nulla non metus auctor fringilla."],
      tags: ["server-tag"],
      starred: false,
      wordCount: 7,
    };
    const merged = backfillNotesContentFromServer([local], [server]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tags).toEqual(["local-tag"]);
    expect(merged[0]?.starred).toBe(true);
    expect(noteHasListableBody(merged[0]!)).toBe(true);
    expect(noteListTitle(merged[0]!)).toMatch(/^Donec ullamcorper/);
    expect(merged[0]?.excerpt).toMatch(/Donec ullamcorper/);
  });

  it("keeps a non-empty local body when backfilling from server", () => {
    const local: Note = { ...sampleNote, body: ["Local draft"], excerpt: "Local draft" };
    const server: Note = { ...sampleNote, body: ["Server body"], excerpt: "Server body" };
    const merged = backfillNotesContentFromServer([local], [server]);
    expect(merged[0]?.body).toEqual(["Local draft"]);
  });

  it("applies collab markdown to body/excerpt/date without bumping updatedAt", () => {
    const withToken = {
      ...sampleNote,
      updatedAt: "2026-01-01T00:00:00.000Z",
      excerpt: "stale preview",
      body: ["Old body"],
    };
    const next = applyNoteBodyMarkdown(
      withToken,
      "Fresh **preview** line\n\nSecond paragraph",
      "2026-06-15T12:00:00.000Z",
    );
    expect(next.body[0]).toContain("Fresh");
    expect(next.excerpt).toMatch(/Fresh preview line/i);
    expect(next.date).toBe("2026-06-15T12:00:00.000Z");
    expect(next.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next.wordCount).toBeGreaterThan(0);
  });

  it("returns the same note reference when collab markdown is unchanged", () => {
    const note = { ...sampleNote, body: ["Same body"] };
    expect(applyNoteBodyMarkdown(note, "Same body")).toBe(note);
  });

  it("AUTOSAVE_WRITE_DEBOUNCE_MS is at least 500ms and at most 3000ms", () => {
    expect(AUTOSAVE_WRITE_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    expect(AUTOSAVE_WRITE_DEBOUNCE_MS).toBeLessThanOrEqual(3000);
  });

  it("filters notes by view and search query", () => {
    const notes: Note[] = [
      { ...sampleNote, id: "n-1", starred: true, archived: false },
      {
        ...sampleNote,
        id: "n-2",
        excerpt: "Other excerpt",
        body: ["Other body"],
        starred: false,
        archived: true,
      },
    ];
    const starredOnly = filterVisibleNotes(notes, {
      view: "starred",
      archived: { "n-2": true },
      starred: { "n-1": true },
      searchQuery: "",
    });
    expect(starredOnly.map((note) => note.id)).toEqual(["n-1"]);

    const searchMatch = filterVisibleNotes(notes, {
      view: "all",
      archived: { "n-2": true },
      starred: { "n-1": true },
      searchQuery: "other",
    });
    expect(searchMatch).toHaveLength(0);
  });

  it("orders visible notes newest-edited first", () => {
    const notes: Note[] = [
      { ...sampleNote, id: "older", date: "2026-01-01T00:00:00.000Z" },
      { ...sampleNote, id: "newer", date: "2026-06-15T12:00:00.000Z" },
      { ...sampleNote, id: "mid", date: "2026-03-01T00:00:00.000Z" },
    ];
    const visible = filterVisibleNotes(notes, {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(visible.map((note) => note.id)).toEqual(["newer", "mid", "older"]);
  });

  it("reorders after a collab body date bump", () => {
    const older: Note = {
      ...sampleNote,
      id: "n-old",
      date: "2026-01-01T00:00:00.000Z",
      body: ["Old body"],
    };
    const newer: Note = {
      ...sampleNote,
      id: "n-new",
      date: "2026-06-01T00:00:00.000Z",
      body: ["New body"],
    };
    const before = filterVisibleNotes([older, newer], {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(before.map((note) => note.id)).toEqual(["n-new", "n-old"]);

    const bumped = applyNoteBodyMarkdown(older, "Edited older note", "2026-07-01T00:00:00.000Z");
    const after = filterVisibleNotes([bumped, newer], {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(after.map((note) => note.id)).toEqual(["n-old", "n-new"]);
  });
});

describe("createNoteSaveDebouncer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not persist immediately when schedule is called", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createNoteSaveDebouncer(500);
    schedule("n-1", sampleNote, persist);
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists the note after the debounce delay", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createNoteSaveDebouncer(500);
    schedule("n-1", sampleNote, persist);
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(sampleNote);
  });

  it("resets the timer when schedule is called again before delay elapses", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createNoteSaveDebouncer(500);
    const updatedNote = { ...sampleNote, body: ["Updated body"] };
    schedule("n-1", sampleNote, persist);
    vi.advanceTimersByTime(300);
    schedule("n-1", updatedNote, persist);
    vi.advanceTimersByTime(300);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(updatedNote);
  });

  it("persists the latest note value when rapid edits arrive", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createNoteSaveDebouncer(500);
    const v1 = { ...sampleNote, body: ["v1"] };
    const v2 = { ...sampleNote, body: ["v2"] };
    const v3 = { ...sampleNote, body: ["v3"] };
    schedule("n-1", v1, persist);
    schedule("n-1", v2, persist);
    schedule("n-1", v3, persist);
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(v3);
  });

  it("tracks different notes independently", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createNoteSaveDebouncer(500);
    const note2 = { ...sampleNote, id: "n-2", body: ["Note 2 body"] };
    schedule("n-1", sampleNote, persist);
    schedule("n-2", note2, persist);
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("flushAll immediately persists all pending notes and cancels timers", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule, flushAll } = createNoteSaveDebouncer(500);
    const note2 = { ...sampleNote, id: "n-2", body: ["Note 2 body"] };
    schedule("n-1", sampleNote, persist);
    schedule("n-2", note2, persist);
    flushAll(persist);
    expect(persist).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("flushAll does nothing when there are no pending saves", () => {
    const persist = vi.fn();
    const { flushAll } = createNoteSaveDebouncer(500);
    flushAll(persist);
    expect(persist).not.toHaveBeenCalled();
  });
});
