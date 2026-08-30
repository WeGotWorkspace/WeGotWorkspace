import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_WRITE_DEBOUNCE_MS,
  applyNoteBodyMarkdown,
  backfillNotesContentFromServer,
  computeExcerpt,
  computeWordCount,
  createNoteSaveDebouncer,
  enrichNote,
  filterNotesByHiddenNotebooks,
  filterVisibleNotes,
  dedupeNotesById,
  mapNotesWithBodyMarkdown,
  mergeBootstrapNotesPreservingOptimistic,
  mergeCreatedNotePreservingLocalOptimistic,
  normalizeNoteBodyMarkdown,
  normalizeTag,
  noteAllowsTagAssignment,
  isPlaceholderNoteListLabel,
  noteHasListableBody,
  shouldDiscardEmptyCreatedNote,
  noteListExcerpt,
  noteListTagOverflow,
  noteListTitle,
  usableNoteListPreview,
  noteListLocationLabel,
  notebookDisplayName,
  notesWithRenamedNotebook,
  noteShowsStarControls,
  noteShowsTags,
  noteShowsSharedBadge,
  noteShowsViewOnlyBadge,
  notesCanCreateInView,
  noteAfterNotebookMove,
  notesViewAfterNotebookMove,
  notesViewForCreate,
  parseGroupNotebookPath,
  resolveNotesCreateTarget,
  sharedNotebookLabel,
  plainTextFromBody,
  preserveLocalListableBodiesOnServerNotes,
} from "./notes-note-utils";
import type { Note } from "@/lib/models/note";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";

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
    expect(noteListTitle({ title: "SUMMARY", excerpt: "Preview line", body: [""] })).toBe(
      "SUMMARY",
    );
  });

  it("shows excerpt only when a title is already set", () => {
    expect(noteListExcerpt({ title: "SUMMARY", excerpt: "Preview line", body: [""] })).toBe(
      "Preview line",
    );
    expect(noteListExcerpt({ excerpt: "Preview line", body: [""] })).toBe("");
  });

  it("never uses FileNode name / local-* id as the list title", () => {
    const localId = "local-dbac4d6cfb5f48d6866278856920ed5a";
    expect(isPlaceholderNoteListLabel(localId, localId)).toBe(true);
    expect(isPlaceholderNoteListLabel("Untitled", localId)).toBe(true);
    expect(usableNoteListPreview(localId, localId)).toBe("");
    expect(usableNoteListPreview("Pasta with garlic", localId)).toBe("Pasta with garlic");

    expect(noteListTitle({ id: localId, excerpt: localId, body: [""] })).toBe("Untitled note");
    expect(noteListTitle({ id: localId, excerpt: localId, body: [localId] })).toBe("Untitled note");
    expect(noteListTitle({ id: localId, excerpt: localId, body: ["First line of the note"] })).toBe(
      "First line of the note",
    );
    expect(noteHasListableBody({ id: localId, body: [localId] })).toBe(false);
    expect(noteHasListableBody({ id: localId, body: ["First line of the note"] })).toBe(true);

    const enriched = enrichNote({
      ...sampleNote,
      id: localId,
      excerpt: localId,
      body: [localId],
      wordCount: 1,
    });
    expect(enriched.excerpt).toBe("");
    expect(noteListTitle(enriched)).toBe("Untitled note");
  });

  it("strips checkbox markdown from list titles and excerpts", () => {
    const body = ["Boodschappen Aug", "- [ ] Bananen", "- [ ] Fruit", "- [ ] Pasta"];
    expect(noteListTitle({ excerpt: "", body })).toBe("Boodschappen Aug Bananen Fruit Pasta");
    expect(computeExcerpt(body)).toBe("Boodschappen Aug Bananen Fruit Pasta");
    // Stale excerpt that still has raw `[ ]` markers must not leak into the list row.
    expect(
      noteListTitle({
        excerpt: "Boodschappen Aug [ ] Bananen [ ] Fruit [ ] Past…",
        body: [""],
      }),
    ).toBe("Boodschappen Aug Bananen Fruit Past");
  });

  it("caps visible list tags and reports overflow", () => {
    expect(noteListTagOverflow(["a", "b"])).toEqual({ visible: ["a", "b"], overflow: 0 });
    expect(noteListTagOverflow(["a", "b", "c", "d"])).toEqual({
      visible: ["a", "b"],
      overflow: 2,
    });
    expect(noteListTagOverflow(["  focus  ", ""])).toEqual({ visible: ["focus"], overflow: 0 });
  });

  it("hides tags and stars for Shared-with-me recipients; shows for owned and group", () => {
    const owned = sampleNote;
    const sharedInbox: Note = {
      ...sampleNote,
      id: "swm",
      sharedInbox: true,
      sharedBy: "bob",
      tags: ["secret"],
    };
    const groupNote: Note = {
      ...sampleNote,
      id: "grp",
      scope: "group",
      groupSlug: "eng",
      tags: ["roadmap"],
    };

    expect(noteShowsTags(owned)).toBe(true);
    expect(noteShowsStarControls(owned)).toBe(true);
    expect(noteAllowsTagAssignment(owned, true)).toBe(true);
    expect(noteAllowsTagAssignment(owned, false)).toBe(false);

    expect(noteShowsTags(sharedInbox)).toBe(false);
    expect(noteShowsStarControls(sharedInbox)).toBe(false);
    expect(noteAllowsTagAssignment(sharedInbox, true)).toBe(false);

    expect(noteShowsTags(groupNote)).toBe(true);
    expect(noteShowsStarControls(groupNote)).toBe(true);
    expect(noteAllowsTagAssignment(groupNote, true)).toBe(true);
    expect(noteAllowsTagAssignment(groupNote, false)).toBe(false);
  });

  it("shows view-only badge only when mayEditContent is false", () => {
    expect(noteShowsViewOnlyBadge(sampleNote)).toBe(false);
    expect(noteShowsViewOnlyBadge({ ...sampleNote, myRights: { mayEditContent: true } })).toBe(
      false,
    );
    expect(
      noteShowsViewOnlyBadge({
        ...sampleNote,
        myRights: { mayEditContent: false },
      }),
    ).toBe(true);
  });

  it("shows Shared badge for owned outgoing shares only", () => {
    expect(noteShowsSharedBadge(sampleNote)).toBe(false);
    expect(noteShowsSharedBadge({ ...sampleNote, isShared: true })).toBe(true);
    expect(
      noteShowsSharedBadge({
        ...sampleNote,
        isShared: true,
        sharedInbox: true,
      }),
    ).toBe(false);
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

  it("preserves cached listable body when server body is still empty after refresh", () => {
    const server: Note = {
      ...sampleNote,
      id: "n-pending-collab",
      excerpt: "",
      body: [""],
      tags: ["server-tag"],
      starred: false,
      wordCount: 0,
      date: "2026-01-01T00:00:00.000Z",
    };
    const local: Note = {
      ...sampleNote,
      id: "n-pending-collab",
      excerpt: "Optimistic preview from typing",
      body: ["Optimistic preview from typing"],
      tags: ["stale-tag"],
      starred: true,
      wordCount: 4,
      date: "2026-08-06T12:00:00.000Z",
    };
    const merged = preserveLocalListableBodiesOnServerNotes([server], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tags).toEqual(["server-tag"]);
    expect(merged[0]?.starred).toBe(false);
    expect(noteListTitle(merged[0]!)).toBe("Optimistic preview from typing");
    expect(merged[0]?.date).toBe("2026-08-06T12:00:00.000Z");
  });

  it("keeps optimistic tags when merging a stale create/bootstrap row", () => {
    const local: Note = {
      ...sampleNote,
      id: "n-new",
      tags: ["focus"],
      date: "2026-08-10T12:00:01.000Z",
    };
    const server: Note = {
      ...sampleNote,
      id: "n-new",
      tags: [],
      date: "2026-08-10T12:00:00.000Z",
    };
    const merged = mergeBootstrapNotesPreservingOptimistic([server], [local]);
    expect(merged[0]?.tags).toEqual(["focus"]);
  });

  it("keeps optimistic archived when merging a stale bootstrap row", () => {
    const local: Note = {
      ...sampleNote,
      archived: true,
      date: "2026-08-10T12:00:00.000Z",
    };
    const server: Note = {
      ...sampleNote,
      archived: false,
      date: "2026-08-10T12:00:00.000Z",
    };
    const merged = mergeBootstrapNotesPreservingOptimistic([server], [local]);
    expect(merged[0]?.archived).toBe(true);
  });

  it("keeps local tags when create response remaps before the tag upsert lands", () => {
    const local: Note = {
      ...sampleNote,
      id: "local-temp",
      tags: ["focus"],
      date: "2026-08-10T12:00:00.000Z",
    };
    const saved: Note = {
      ...sampleNote,
      id: "n-server",
      tags: [],
      date: "2026-08-10T12:00:05.000Z",
      updatedAt: "2026-08-10T12:00:05.000Z",
    };
    const merged = mergeCreatedNotePreservingLocalOptimistic(saved, local);
    expect(merged.id).toBe("n-server");
    expect(merged.tags).toEqual(["focus"]);
    expect(merged.date).toBe(saved.date);
  });

  it("keeps a typed SUMMARY when create remaps with an empty server title", () => {
    const local: Note = {
      ...sampleNote,
      id: "local-temp",
      title: "Meeting notes",
      excerpt: "",
      body: [""],
      date: "2026-08-10T12:00:00.000Z",
    };
    const saved: Note = {
      ...sampleNote,
      id: "n-server",
      title: undefined,
      excerpt: "",
      body: [""],
      date: "2026-08-10T12:00:05.000Z",
    };
    const merged = mergeCreatedNotePreservingLocalOptimistic(saved, local);
    expect(merged.id).toBe("n-server");
    expect(merged.title).toBe("Meeting notes");
    expect(noteListTitle(merged)).toBe("Meeting notes");
  });

  it("never treats an empty created note as a disposable draft", () => {
    expect(
      shouldDiscardEmptyCreatedNote({ title: undefined, body: [""], excerpt: "" }),
    ).toBe(false);
    expect(shouldDiscardEmptyCreatedNote({ title: "Event", body: [""], excerpt: "" })).toBe(false);
  });

  it("keeps an empty untitled create when bootstrap omits the new note", () => {
    const created: Note = {
      ...sampleNote,
      id: "local-abc0de",
      title: undefined,
      excerpt: "",
      body: [""],
      wordCount: 0,
      date: "2026-08-29T09:00:00.000Z",
    };
    const merged = mergeBootstrapNotesPreservingOptimistic([sampleNote], [created, sampleNote]);
    expect(merged.map((note) => note.id)).toEqual(["n-1", "local-abc0de"]);
    expect(merged.find((note) => note.id === "local-abc0de")?.body).toEqual([""]);
  });

  it("keeps an optimistic create (and its title) when bootstrap omits the new note", () => {
    const created: Note = {
      ...sampleNote,
      id: "local-abc123",
      title: "Event",
      excerpt: "",
      body: [""],
      date: "2026-08-29T09:00:00.000Z",
    };
    const merged = mergeBootstrapNotesPreservingOptimistic([sampleNote], [created, sampleNote]);
    expect(merged.map((note) => note.id)).toEqual(["n-1", "local-abc123"]);
    expect(merged.find((note) => note.id === "local-abc123")?.title).toBe("Event");
  });

  it("keeps a typed title when bootstrap still has an empty SUMMARY", () => {
    const local: Note = {
      ...sampleNote,
      title: "Event",
      date: "2026-08-29T09:00:01.000Z",
    };
    const server: Note = {
      ...sampleNote,
      title: undefined,
      date: "2026-08-29T09:00:00.000Z",
    };
    const merged = mergeBootstrapNotesPreservingOptimistic([server], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("Event");
  });

  it("prefers non-empty server body over cached body on refresh merge", () => {
    const server: Note = {
      ...sampleNote,
      body: ["Server wins"],
      excerpt: "Server wins",
    };
    const local: Note = {
      ...sampleNote,
      body: ["Stale cache"],
      excerpt: "Stale cache",
    };
    const merged = preserveLocalListableBodiesOnServerNotes([server], [local]);
    expect(merged[0]?.body).toEqual(["Server wins"]);
  });

  it("applies collab markdown to body/excerpt/date without bumping updatedAt", () => {
    const withToken = {
      ...sampleNote,
      updatedAt: "2026-01-01T00:00:00.000Z",
      excerpt: "stale preview",
      body: ["Old body"],
    };
    const next = applyNoteBodyMarkdown(withToken, "Fresh **preview** line\n\nSecond paragraph", {
      editedAt: "2026-06-15T12:00:00.000Z",
    });
    expect(next.body[0]).toContain("Fresh");
    expect(next.excerpt).toMatch(/Fresh preview line/i);
    expect(next.date).toBe("2026-06-15T12:00:00.000Z");
    expect(next.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next.wordCount).toBeGreaterThan(0);
  });

  it("hydrates body/excerpt without bumping display date", () => {
    const emptyPreview = {
      ...sampleNote,
      date: "2026-01-01T00:00:00.000Z",
      excerpt: "",
      body: [""],
      wordCount: 0,
    };
    const next = applyNoteBodyMarkdown(emptyPreview, "Loaded from Yjs after refresh", {
      bumpDate: false,
    });
    expect(noteListTitle(next)).toBe("Loaded from Yjs after refresh");
    expect(next.date).toBe("2026-01-01T00:00:00.000Z");
  });

  it("treats TipTap trailing newlines as unchanged (avoids hydrate setState loops)", () => {
    const note = {
      ...sampleNote,
      title: "Hello world",
      body: ["Hello world"],
      excerpt: "Hello world",
    };
    expect(normalizeNoteBodyMarkdown("Hello world\n\n")).toBe("Hello world");
    expect(applyNoteBodyMarkdown(note, "Hello world\n")).toBe(note);
    expect(applyNoteBodyMarkdown(note, "Hello world\r\n")).toBe(note);
  });

  it("autofills empty SUMMARY from the first heading; later edits stick", () => {
    const untitled = { ...sampleNote, title: undefined, body: [""], excerpt: "" };
    const filled = applyNoteBodyMarkdown(untitled, "# Meeting\n\nNotes");
    expect(filled.title).toBe("Meeting");
    const stuck = applyNoteBodyMarkdown({ ...filled, title: "Kept" }, "# Other\n\nNotes");
    expect(stuck.title).toBe("Kept");
  });

  it("does not copy an in-progress body line into SUMMARY", () => {
    const untitled = { ...sampleNote, title: undefined, body: [""], excerpt: "" };
    expect(applyNoteBodyMarkdown(untitled, "H").title).toBeUndefined();
    expect(applyNoteBodyMarkdown(untitled, "Hello").title).toBeUndefined();
    expect(applyNoteBodyMarkdown(untitled, "Hello\n").title).toBeUndefined();
    expect(applyNoteBodyMarkdown(untitled, "Hello").title).not.toBe("H");
    expect(applyNoteBodyMarkdown(untitled, "Hello\n\nworld").title).toBe("Hello");
  });

  it("does not overwrite a user-typed title when the body changes", () => {
    const titled = { ...sampleNote, title: "Event", body: [""], excerpt: "" };
    expect(applyNoteBodyMarkdown(titled, "Hello").title).toBe("Event");
    expect(applyNoteBodyMarkdown(titled, "Hello\n\nworld").title).toBe("Event");
  });

  it("returns the same notes array when hydrate markdown is unchanged", () => {
    const notes = [
      { ...sampleNote, title: "Stable body", body: ["Stable body"], excerpt: "Stable body" },
    ];
    const first = mapNotesWithBodyMarkdown(notes, "n-1", "Stable body\n", { bumpDate: false });
    expect(first.notes).toBe(notes);
    expect(first.updated).toBeUndefined();

    const second = mapNotesWithBodyMarkdown(notes, "n-1", "Changed body", { bumpDate: false });
    expect(second.notes).not.toBe(notes);
    expect(second.updated?.excerpt).toMatch(/Changed body/);
  });

  it("returns the same note reference when collab markdown is unchanged", () => {
    const note = { ...sampleNote, title: "Same body", body: ["Same body"] };
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
      {
        ...sampleNote,
        id: "shared-1",
        excerpt: "Shared title",
        body: ["Shared title"],
        notebook: "TeamPad",
        sharedInbox: true,
        apiPath: "/users/bob/.notes/TeamPad/shared-1.md",
        scope: "personal",
      },
      {
        ...sampleNote,
        id: "group-1",
        notebook: "Specs",
        scope: "group",
        groupSlug: "eng",
        body: ["Group note"],
        excerpt: "Group note",
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

    const sharedWithMeEmpty = filterVisibleNotes(notes, {
      view: "shared-with-me",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(sharedWithMeEmpty).toEqual([]);

    const inboundShared: Note = {
      ...sampleNote,
      id: "inbound-1",
      notebook: "Shared Notes",
      notebookId: "shared-nb",
      excerpt: "Inbound shared note",
      body: ["Inbound shared note"],
    };
    const sharedWithMe = filterVisibleNotes([...notes, inboundShared], {
      view: "shared-with-me",
      archived: {},
      starred: {},
      searchQuery: "",
      sharedNotebookKeys: new Set(["shared-nb", "Shared Notes"]),
    });
    expect(sharedWithMe.map((note) => note.id)).toEqual(["inbound-1"]);

    const personalNb = filterVisibleNotes(notes, {
      view: "nb:Drafts",
      archived: { "n-2": true },
      starred: {},
      searchQuery: "",
    });
    expect(personalNb.map((note) => note.id)).toEqual(["n-1"]);

    const sharedNotebookView = filterVisibleNotes([...notes, inboundShared], {
      view: "nb:shared-nb",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(sharedNotebookView.map((note) => note.id)).toEqual(["inbound-1"]);

    const sharedNb = filterVisibleNotes(notes, {
      view: "shared-nb:/groups/eng/.notes/Specs",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(sharedNb.map((note) => note.id)).toEqual(["group-1"]);
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

  it("dedupes duplicate note ids before listing (keeps first occurrence)", () => {
    const first: Note = {
      ...sampleNote,
      id: "dup",
      excerpt: "First",
      body: ["First"],
      notebook: "Test",
      date: "2026-08-06T11:55:00.000Z",
    };
    const second: Note = {
      ...sampleNote,
      id: "dup",
      excerpt: "Second",
      body: ["Second"],
      notebook: "Drafts",
      date: "2026-08-06T11:54:00.000Z",
    };
    expect(dedupeNotesById([first, second]).map((note) => note.excerpt)).toEqual(["First"]);

    const visible = filterVisibleNotes([first, second, { ...sampleNote, id: "other" }], {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(visible.map((note) => note.id)).toEqual(["dup", "other"]);
    expect(visible.filter((note) => note.id === "dup")).toHaveLength(1);
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

    const bumped = applyNoteBodyMarkdown(older, "Edited older note", {
      editedAt: "2026-07-01T00:00:00.000Z",
    });
    const after = filterVisibleNotes([bumped, newer], {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "",
    });
    expect(after.map((note) => note.id)).toEqual(["n-old", "n-new"]);
  });

  it("search matches a title-only note", () => {
    const notes: Note[] = [{ ...sampleNote, id: "n-1", title: "Event", excerpt: "", body: [""] }];
    const match = filterVisibleNotes(notes, {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "event",
    });
    expect(match.map((note) => note.id)).toEqual(["n-1"]);
  });

  it("search matches the live collection name after a rename", () => {
    const notes: Note[] = [
      { ...sampleNote, id: "n-1", notebook: "Drafts", notebookId: "notes-drafts" },
    ];
    const match = filterVisibleNotes(notes, {
      view: "all",
      archived: {},
      starred: {},
      searchQuery: "journal",
      notebookCollections: [{ id: "notes-drafts", name: "Journal" }],
    });
    expect(match.map((note) => note.id)).toEqual(["n-1"]);
  });

  it("filterNotesByHiddenNotebooks drops hidden notebooks except on a notebook view", () => {
    const notes: Note[] = [
      { ...sampleNote, id: "a", notebook: "Drafts", notebookId: "drafts" },
      { ...sampleNote, id: "b", notebook: "Work", notebookId: "work" },
    ];
    const hidden = new Set(["work"]);
    expect(filterNotesByHiddenNotebooks(notes, "all", hidden).map((note) => note.id)).toEqual([
      "a",
    ]);
    expect(filterNotesByHiddenNotebooks(notes, "nb:work", hidden).map((note) => note.id)).toEqual([
      "a",
      "b",
    ]);
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

  it("remapId moves a pending save onto the server id", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule, remapId } = createNoteSaveDebouncer(500);
    const titled = { ...sampleNote, id: "local-temp", title: "Event" };
    schedule("local-temp", titled, persist);
    remapId("local-temp", "n-server");
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({ ...titled, id: "n-server" });
  });
});

describe("notebookDisplayName", () => {
  it("prefers the live collection name by id over a stale denormalized string", () => {
    expect(
      notebookDisplayName({ ...sampleNote, notebook: "Drafts", notebookId: "notes-drafts" }, [
        { id: "notes-drafts", name: "Journal" },
      ]),
    ).toBe("Journal");
  });

  it("leaves other notebooks unchanged", () => {
    expect(
      notebookDisplayName({ ...sampleNote, notebook: "Work", notebookId: "notes-work" }, [
        { id: "notes-drafts", name: "Journal" },
        { id: "notes-work", name: "Work" },
      ]),
    ).toBe("Work");
  });
});

describe("notesWithRenamedNotebook", () => {
  it("rewrites notes that match the renamed collection id", () => {
    const notes = [
      { ...sampleNote, id: "a", notebook: "Drafts", notebookId: "notes-drafts" },
      { ...sampleNote, id: "b", notebook: "Work", notebookId: "notes-work" },
    ];
    expect(
      notesWithRenamedNotebook(notes, {
        notebookId: "notes-drafts",
        fromName: "Drafts",
        toName: "Journal",
      }).map((note) => ({ id: note.id, notebook: note.notebook })),
    ).toEqual([
      { id: "a", notebook: "Journal" },
      { id: "b", notebook: "Work" },
    ]);
  });
});

describe("noteListLocationLabel", () => {
  it("returns notebook name for owned notes", () => {
    expect(noteListLocationLabel(sampleNote, defaultNotesLabels)).toBe("Drafts");
  });

  it("resolves the live collection name after a rename", () => {
    expect(
      noteListLocationLabel(
        { ...sampleNote, notebook: "Drafts", notebookId: "notes-drafts" },
        defaultNotesLabels,
        [{ id: "notes-drafts", name: "Journal" }],
      ),
    ).toBe("Journal");
  });

  it("returns grantor username for shared-inbox notes", () => {
    expect(
      noteListLocationLabel(
        {
          ...sampleNote,
          sharedInbox: true,
          sharedBy: "bob",
          notebook: "TeamPad",
        },
        defaultNotesLabels,
      ),
    ).toBe("bob");
  });

  it("falls back to Shared with me when grantor is missing", () => {
    expect(
      noteListLocationLabel(
        { ...sampleNote, sharedInbox: true, notebook: "TeamPad" },
        defaultNotesLabels,
      ),
    ).toBe("Shared with me");
  });

  it("returns group slug for group-scoped notes (single notebook per group)", () => {
    expect(
      noteListLocationLabel(
        {
          ...sampleNote,
          notebook: "General",
          scope: "group",
          groupSlug: "administrators",
        },
        defaultNotesLabels,
      ),
    ).toBe("administrators");
  });

  it("sharedNotebookLabel uses group name for membership notebooks", () => {
    expect(
      sharedNotebookLabel({
        notebook: "General",
        owner: "administrators",
        scope: "group",
        groupSlug: "administrators",
      }),
    ).toBe("administrators");
  });

  it("sharedNotebookLabel keeps notebook name for non-group rows", () => {
    expect(
      sharedNotebookLabel({
        notebook: "TeamPad",
        owner: "bob",
        scope: "personal",
        groupSlug: null,
      }),
    ).toBe("TeamPad");
  });
});

describe("group notebook create targets", () => {
  it("parses groups/{slug}/.notes/{notebook} paths", () => {
    expect(parseGroupNotebookPath("/groups/eng/.notes/Specs")).toEqual({
      groupSlug: "eng",
      notebook: "Specs",
    });
    expect(parseGroupNotebookPath("groups/eng/.notes/Specs/")).toEqual({
      groupSlug: "eng",
      notebook: "Specs",
    });
    expect(parseGroupNotebookPath("/users/bob/.notes/TeamPad")).toBeNull();
  });

  it("allows New note in group membership notebooks only", () => {
    expect(notesCanCreateInView("all")).toBe(true);
    expect(notesCanCreateInView("nb:Drafts")).toBe(true);
    expect(notesCanCreateInView("starred")).toBe(true);
    expect(notesCanCreateInView("archive")).toBe(true);
    expect(notesCanCreateInView("shared-nb:/groups/eng/.notes/General")).toBe(true);
    expect(notesCanCreateInView("shared-nb:/users/bob/.notes/TeamPad")).toBe(false);
    expect(notesCanCreateInView("shared-with-me")).toBe(false);
  });

  it("switches Starred and Archive create to All Items", () => {
    expect(notesViewForCreate("starred")).toBe("all");
    expect(notesViewForCreate("archive")).toBe("all");
    expect(notesViewForCreate("nb:Drafts")).toBe("nb:Drafts");
    expect(notesViewForCreate("tag:focus")).toBe("tag:focus");
    expect(resolveNotesCreateTarget(notesViewForCreate("starred"), ["Drafts"])).toEqual({
      notebook: "Drafts",
    });
    expect(resolveNotesCreateTarget(notesViewForCreate("archive"), ["Drafts"])).toEqual({
      notebook: "Drafts",
    });
  });

  it("resolves create target notebook + groupSlug from shared-nb view", () => {
    expect(resolveNotesCreateTarget("shared-nb:/groups/eng/.notes/Specs", ["Drafts"])).toEqual({
      notebook: "Specs",
      scope: "group",
      groupSlug: "eng",
    });
    expect(resolveNotesCreateTarget("nb:Ideas", ["Drafts"])).toEqual({ notebook: "Ideas" });
    expect(resolveNotesCreateTarget("all", ["Drafts"])).toEqual({ notebook: "Drafts" });
  });
});

describe("noteAfterNotebookMove", () => {
  it("clears group scope when moving to a personal notebook", () => {
    const moved = noteAfterNotebookMove(
      { ...sampleNote, scope: "group", groupSlug: "eng", notebook: "Specs", notebookId: "group-eng" },
      { id: "notes-work", name: "Work", scope: "personal" },
    );
    expect(moved).toEqual(
      expect.objectContaining({
        notebook: "Work",
        notebookId: "notes-work",
        scope: "personal",
        groupSlug: undefined,
      }),
    );
  });

  it("stamps dest group scope when moving into a group notebook", () => {
    const moved = noteAfterNotebookMove(sampleNote, {
      id: "group-eng",
      name: "Specs",
      scope: "group",
      groupSlug: "eng",
    });
    expect(moved).toEqual(
      expect.objectContaining({
        notebook: "Specs",
        notebookId: "group-eng",
        scope: "group",
        groupSlug: "eng",
      }),
    );
  });
});

describe("notesViewAfterNotebookMove", () => {
  const dest = { id: "notes-work", name: "Work" };
  const moved = {
    ...sampleNote,
    notebook: dest.name,
    notebookId: dest.id,
  };

  it("follows the destination notebook when the current notebook view no longer contains the note", () => {
    const filter = { archived: {}, starred: {} };
    expect(notesViewAfterNotebookMove("nb:notes-drafts", dest, moved, filter)).toBe(
      "nb:notes-work",
    );
    expect(notesViewAfterNotebookMove("nb:Drafts", dest, moved, filter)).toBe("nb:notes-work");
  });

  it("stays on All, Starred, Archive, and Tags when the moved note still belongs", () => {
    const tagged = { ...moved, tags: ["focus"], starred: true };
    expect(
      notesViewAfterNotebookMove("all", dest, tagged, {
        archived: {},
        starred: { [tagged.id]: true },
      }),
    ).toBe("all");
    expect(
      notesViewAfterNotebookMove("starred", dest, tagged, {
        archived: {},
        starred: { [tagged.id]: true },
      }),
    ).toBe("starred");
    expect(
      notesViewAfterNotebookMove("archive", dest, tagged, {
        archived: { [tagged.id]: true },
        starred: {},
      }),
    ).toBe("archive");
    expect(
      notesViewAfterNotebookMove("tag:focus", dest, tagged, { archived: {}, starred: {} }),
    ).toBe("tag:focus");
  });

  it("leaves Starred or Tags for the destination when the note no longer belongs", () => {
    const otherTag = { ...moved, tags: ["other"] };
    expect(
      notesViewAfterNotebookMove("starred", dest, otherTag, { archived: {}, starred: {} }),
    ).toBe("nb:notes-work");
    expect(
      notesViewAfterNotebookMove("tag:focus", dest, otherTag, { archived: {}, starred: {} }),
    ).toBe("nb:notes-work");
  });
});
