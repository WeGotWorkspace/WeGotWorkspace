import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Note } from "@/lib/models/note";
import { enrichNotesListPreviewsFromCollabOffline } from "@/lib/offline/notes/notes-list-preview-enrich";
import { noteCollabPath } from "@/notes-core/src/note-collab-path";
import { noteListTitle } from "@/notes-core/src/notes-note-utils";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { docsCollabRoomKey } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { collabDocumentFormat } from "@/text-editor-core/docs-collab/docs-collab-utils";

async function seedCollabRoom(room: string, content: string): Promise<void> {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, content, collabDocumentFormat(room));
  const persistence = new IndexeddbPersistence(room, ydoc);
  await persistence.whenSynced;
  await persistence.destroy();
  ydoc.destroy();
}

describe("enrichNotesListPreviewsFromCollabOffline", () => {
  it("fills empty list previews from collab IDB without selecting the note", async () => {
    const username = "alice";
    const empty: Note = {
      id: "n-reload",
      category: "Note",
      date: "2026-01-01T00:00:00.000Z",
      excerpt: "",
      body: [""],
      notebook: "Drafts",
      tags: [],
      wordCount: 0,
    };
    const alreadyFilled: Note = {
      ...empty,
      id: "n-filled",
      excerpt: "Already on disk",
      body: ["Already on disk"],
      wordCount: 3,
    };

    const path = noteCollabPath({
      scope: { kind: "personal", username },
      notebook: "Drafts",
      noteId: empty.id,
    });
    await seedCollabRoom(docsCollabRoomKey(path), "Typed offline — survives hard reload");

    const enriched = await enrichNotesListPreviewsFromCollabOffline(username, [
      empty,
      alreadyFilled,
    ]);

    expect(noteListTitle(enriched[0]!)).toMatch(/Typed offline/);
    expect(enriched[0]?.excerpt).toMatch(/Typed offline/);
    expect(enriched[1]?.body).toEqual(["Already on disk"]);
    expect(enriched[1]).toBe(alreadyFilled);
  });

  it("enriches multiple empty rows from IDB so reload does not require selecting each note", async () => {
    const username = "alice";
    const notes: Note[] = ["a", "b", "c"].map((suffix) => ({
      id: `n-${suffix}`,
      category: "Note",
      date: "2026-01-01T00:00:00.000Z",
      excerpt: "",
      body: [""],
      notebook: "Drafts",
      tags: [],
      wordCount: 0,
    }));

    for (const note of notes) {
      const path = noteCollabPath({
        scope: { kind: "personal", username },
        notebook: "Drafts",
        noteId: note.id,
      });
      await seedCollabRoom(docsCollabRoomKey(path), `Preview for ${note.id}`);
    }

    const enriched = await enrichNotesListPreviewsFromCollabOffline(username, notes);
    expect(enriched.map((note) => noteListTitle(note))).toEqual([
      "Preview for n-a",
      "Preview for n-b",
      "Preview for n-c",
    ]);
  });

  it("enriches rows whose list label is still a local-* FileNode name", async () => {
    const username = "alice";
    const localId = "local-dbac4d6cfb5f48d6866278856920ed5a";
    const stuckOnId: Note = {
      id: localId,
      category: "Note",
      date: "2026-01-01T00:00:00.000Z",
      excerpt: localId,
      body: [localId],
      notebook: "Drafts",
      tags: [],
      wordCount: 1,
    };
    const path = noteCollabPath({
      scope: { kind: "personal", username },
      notebook: "Drafts",
      noteId: localId,
    });
    await seedCollabRoom(docsCollabRoomKey(path), "Typed after offline create");

    const enriched = await enrichNotesListPreviewsFromCollabOffline(username, [stuckOnId]);
    expect(noteListTitle(enriched[0]!)).toBe("Typed after offline create");
    expect(enriched[0]?.excerpt).toMatch(/Typed after offline create/);
  });

  it("leaves empty notes alone when no collab snapshot exists", async () => {
    const empty: Note = {
      id: "n-missing",
      category: "Note",
      date: "2026-01-01T00:00:00.000Z",
      excerpt: "",
      body: [""],
      notebook: "Drafts",
      tags: [],
      wordCount: 0,
    };
    const enriched = await enrichNotesListPreviewsFromCollabOffline("alice", [empty]);
    expect(noteListTitle(enriched[0]!)).toBe("Untitled note");
  });
});
