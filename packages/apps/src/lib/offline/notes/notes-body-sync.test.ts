import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { syncNotesBodiesForOffline } from "@/lib/offline/notes/notes-body-sync";

const { hydrateDocsCollabForOffline } = vi.hoisted(() => ({
  hydrateDocsCollabForOffline: vi.fn(),
}));

vi.mock("@/lib/offline/docs/docs-pin-hydrate", () => ({
  hydrateDocsCollabForOffline,
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
}));

describe("syncNotesBodiesForOffline", () => {
  beforeEach(() => {
    hydrateDocsCollabForOffline.mockReset();
  });

  it("does not hydrate Drive /files/collaboration paths", async () => {
    const notes: Note[] = [
      {
        id: "n-1",
        category: "Note",
        date: "2024-01-01T00:00:00.000Z",
        excerpt: "",
        body: ["One"],
        notebook: "Drafts",
        tags: [],
        wordCount: 1,
      },
    ];

    const result = await syncNotesBodiesForOffline("alice", notes);

    expect(result.total).toBe(1);
    expect(result.synced).toBe(1);
    expect(hydrateDocsCollabForOffline).not.toHaveBeenCalled();
  });
});
