import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { dropLocalNoteAfterServerGone, upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { type NoteDropped, subscribeNoteDropped } from "./notes-dropped-events";

const note: Note = {
  id: "4b1c2d3e-0000-4000-8000-0000000000d1",
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "General",
  title: "Shopping list",
  tags: [],
  wordCount: 0,
};

describe("dropLocalNoteAfterServerGone", () => {
  it("tells every tab which note was dropped, by title, so no edit is lost silently", async () => {
    await upsertNoteInCache("dropped-user", note, true);
    const heard: NoteDropped[] = [];
    const stop = subscribeNoteDropped((dropped) => heard.push(dropped));

    await dropLocalNoteAfterServerGone("dropped-user", note.id);
    stop();

    expect(heard).toEqual([{ username: "dropped-user", noteId: note.id, title: "Shopping list" }]);
  });
});
