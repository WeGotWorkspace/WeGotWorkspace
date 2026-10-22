import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Note } from "@/lib/models/note";
import { upsertNoteInCache } from "@/lib/offline/notes-offline-store";
import { uploadPendingNoteBodies } from "./notes-pending-bodies";

const uploaded = vi.hoisted(() => vi.fn(async (_rooms: unknown[]) => undefined));
vi.mock("@/text-editor-core/docs-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/text-editor-core/docs-collab")>()),
  uploadPendingCollabRooms: uploaded,
}));

const note = (id: string): Note => ({
  id,
  category: "Note",
  date: "2026-10-22T10:00:00.000Z",
  excerpt: "",
  body: [""],
  notebook: "General",
  tags: [],
  wordCount: 0,
});

describe("uploadPendingNoteBodies", () => {
  it("probes only notes that have a body database, and creates none", async () => {
    const withBody = "4b1c2d3e-0000-4000-8000-0000000000b1";
    const withoutBody = "4b1c2d3e-0000-4000-8000-0000000000b2";
    await upsertNoteInCache("bodies-user", note(withBody), false);
    await upsertNoteInCache("bodies-user", note(withoutBody), false);
    const persistence = new IndexeddbPersistence(`${withBody}:v2`, new Y.Doc());
    await persistence.whenSynced;
    await persistence.destroy();

    await uploadPendingNoteBodies("bodies-user");

    const rooms = (uploaded.mock.calls[0]?.[0] ?? []) as Array<{ databaseName: string }>;
    expect(rooms.map((room) => room.databaseName)).toEqual([`${withBody}:v2`]);
    const names = (await indexedDB.databases()).map((row) => row.name);
    expect(names).not.toContain(`${withoutBody}:v2`);
  });
});
