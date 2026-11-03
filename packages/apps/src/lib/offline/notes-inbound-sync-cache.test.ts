import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { noteFromVjournal, type NotesVjournalNote } from "@/lib/api/wgw/notes-vjournal";
import {
  readNotesBootstrapFromCache,
  writeNotesBootstrapToCache,
} from "@/lib/offline/notes-offline-store";
import { syncNotesInboundFromRest } from "@/lib/offline/notes-inbound-sync";

vi.mock("@/lib/api/wgw/notes-vjournal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/notes-vjournal")>();
  return {
    ...actual,
    listNotebookChanges: vi.fn(async () => ({
      oldState: "0",
      newState: "nb-1",
      created: [],
      updated: [],
      destroyed: [],
    })),
    listNoteChanges: vi.fn(async () => ({
      newState: "n-1",
      created: [],
      updated: [],
      destroyed: [],
    })),
    listNotes: vi.fn(),
    getNote: vi.fn(),
  };
});

import { listNotes } from "@/lib/api/wgw/notes-vjournal";

const username = "prune-user";
const notebooks = [{ id: "notes-general", name: "General" }];
const row = (id: string, title: string): NotesVjournalNote => ({
  id,
  notebookId: "notes-general",
  title,
  body: "",
  categories: [],
  status: null,
  etag: `"${id}"`,
});

describe("syncNotesInboundFromRest with the real cache", () => {
  it("drops a cached note the full list no longer has (notes mapped as the app maps them)", async () => {
    const kept = row("4b1c2d3e-0000-4000-8000-0000000000c1", "Kept");
    const gone = row("4b1c2d3e-0000-4000-8000-0000000000c2", "Deleted elsewhere");
    await writeNotesBootstrapToCache(
      username,
      {
        session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
        data: {
          notes: [kept, gone].map((item) => noteFromVjournal(item, notebooks)),
          notebooks: ["General"],
          notebookCollections: notebooks,
          tags: [],
        },
      },
      Date.now(),
    );
    vi.mocked(listNotes).mockResolvedValue([kept]);

    await syncNotesInboundFromRest(username);

    const ids = (await readNotesBootstrapFromCache(username))?.data.notes.map((note) => note.id);
    expect(ids).toEqual([kept.id]);
  });
});
