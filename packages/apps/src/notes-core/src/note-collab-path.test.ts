import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import { NOTES_TOO_LARGE_MESSAGE } from "@/notes-core/src/notes-collab-errors";
import { encodeNoteRoomId } from "@/notes-core/src/note-collab-path";

const getNote = vi.fn();
const persistNoteMarkdown = vi.fn();
const wgwEnsureFreshAccessToken = vi.fn();

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "https://api.test",
  wgwEnsureFreshAccessToken: () => wgwEnsureFreshAccessToken(),
}));

vi.mock("@/lib/api/wgw/notes-vjournal", () => ({
  getNote: (...args: unknown[]) => getNote(...args),
  persistNoteMarkdown: (...args: unknown[]) => persistNoteMarkdown(...args),
}));

describe("encodeNoteRoomId", () => {
  it("encodes the VJOURNAL UID, not a Drive .notes path", () => {
    const uid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(encodeNoteRoomId(uid)).toBe(encodeFileRoomId(uid));
    expect(encodeNoteRoomId(uid)).not.toContain(".notes");
  });
});

describe("buildNoteCollabUrls reconnect + persist", () => {
  beforeEach(() => {
    getNote.mockReset();
    persistNoteMarkdown.mockReset();
    wgwEnsureFreshAccessToken.mockResolvedValue("token");
  });

  it("uses the workspace getLocalDirty getter and opens conflict when dirty + stale", async () => {
    const { buildNoteCollabUrls } = await import("@/notes-core/src/note-collab-path");
    getNote.mockResolvedValue({ id: "n1", body: "theirs", etag: '"new"' });
    const getLocalDirty = vi.fn(() => true);
    const onReconnectConflict = vi.fn();

    const urls = await buildNoteCollabUrls("n1", '"old"', {
      getLocalDirty,
      onReconnectConflict,
    });

    await expect(urls.loadDocumentMarkdown?.()).rejects.toThrow(/precondition failed \(412\)/);
    expect(getLocalDirty).toHaveBeenCalled();
    expect(onReconnectConflict).toHaveBeenCalledOnce();
  });

  it("maps 413 persist to a permanent too-large error", async () => {
    const { buildNoteCollabUrls } = await import("@/notes-core/src/note-collab-path");
    persistNoteMarkdown.mockRejectedValue(
      Object.assign(new Error("PATCH failed (413)"), { status: 413, code: "markdown_too_large" }),
    );

    const urls = await buildNoteCollabUrls("n1", '"etag"');
    await expect(urls.persistMarkdown?.("x".repeat(10))).rejects.toMatchObject({
      message: NOTES_TOO_LARGE_MESSAGE,
      status: 413,
    });
  });
});
