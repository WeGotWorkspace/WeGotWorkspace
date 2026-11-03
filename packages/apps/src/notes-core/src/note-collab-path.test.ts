import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import { encodeNoteRoomId } from "@/notes-core/src/note-collab-path";

const wgwEnsureFreshAccessToken = vi.fn();

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "https://api.test",
  wgwEnsureFreshAccessToken: () => wgwEnsureFreshAccessToken(),
}));

describe("encodeNoteRoomId", () => {
  it("encodes the VJOURNAL UID, not a Drive .notes path", () => {
    const uid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(encodeNoteRoomId(uid)).toBe(encodeFileRoomId(uid));
    expect(encodeNoteRoomId(uid)).not.toContain(".notes");
  });
});

describe("buildNoteCollabUrls", () => {
  beforeEach(() => {
    wgwEnsureFreshAccessToken.mockResolvedValue("token");
  });

  it("loads and saves the note through the shared document URLs", async () => {
    const { buildNoteCollabUrls } = await import("@/notes-core/src/note-collab-path");
    const onPersistSuccess = vi.fn();
    const urls = await buildNoteCollabUrls("n1", { onPersistSuccess });

    expect(urls.documentUrl).toBe("https://api.test/notes/items/n1");
    expect(urls.yjsUrl).toBe("https://api.test/notes/items/n1?format=yjs");
    expect(urls.room).toBe("n1");
    expect(urls.roomNotPersistent).toBe(false);
    expect(urls.authToken).toBe("token");
    expect(urls.signalUrl).toContain("/rooms/");
    expect(urls).not.toHaveProperty("persistMarkdown");
    expect(urls).not.toHaveProperty("loadDocumentMarkdown");
    expect(urls).not.toHaveProperty("skipYjsSnapshot");
    expect(urls).not.toHaveProperty("documentSaveMethod");

    urls.onPersistSuccess?.("saved body");
    expect(onPersistSuccess).toHaveBeenCalledWith("saved body");
  });

  it("keeps a note whose create is still queued in a local-only room", async () => {
    const { buildNoteCollabUrls } = await import("@/notes-core/src/note-collab-path");
    const urls = await buildNoteCollabUrls("c55e3aa6-8b22-4bea-b477-053dfeb10efd", {
      createPending: true,
    });

    expect(urls.roomNotPersistent).toBe(true);
    expect(urls.yjsUrl).toContain("?format=yjs");
  });
});
