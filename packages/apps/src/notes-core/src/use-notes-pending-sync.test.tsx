import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/notes-offline-store", () => ({
  listPendingNoteIds: vi.fn(),
  readNotesBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/notes/notes-collab-rooms", () => ({
  hasNoteCollabPendingServerSave: vi.fn(),
}));

import { hasNoteCollabPendingServerSave } from "@/lib/offline/notes/notes-collab-rooms";
import { listPendingNoteIds, readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import { useNotesPendingSync } from "@/notes-core/src/use-notes-pending-sync";

describe("useNotesPendingSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readNotesBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(hasNoteCollabPendingServerSave).mockResolvedValue(false);
  });

  it("returns an empty set and skips the read when no username is known", () => {
    const { result } = renderHook(() => useNotesPendingSync(null));
    expect(result.current.size).toBe(0);
    expect(listPendingNoteIds).not.toHaveBeenCalled();
  });

  it("exposes the pending note ids read from the offline store", async () => {
    vi.mocked(listPendingNoteIds).mockResolvedValue(["note-1", "note-2"]);
    const { result } = renderHook(() => useNotesPendingSync("bob"));

    await waitFor(() => expect(result.current.has("note-1")).toBe(true));
    expect(result.current.has("note-2")).toBe(true);
    expect(result.current.size).toBe(2);
  });

  it("still shows the list dot for metadata-pending notes", async () => {
    vi.mocked(listPendingNoteIds).mockResolvedValue(["meta-pending"]);
    const { result } = renderHook(() => useNotesPendingSync("bob"));

    await waitFor(() => expect(result.current.has("meta-pending")).toBe(true));
  });

  it("unions metadata pending ids with UID-keyed collab body pending", async () => {
    vi.mocked(listPendingNoteIds).mockResolvedValue(["meta-1"]);
    vi.mocked(readNotesBootstrapFromCache).mockResolvedValue({
      data: { notes: [{ id: "body-1" }, { id: "meta-1" }] },
    } as never);
    vi.mocked(hasNoteCollabPendingServerSave).mockImplementation(async (uid) => uid === "body-1");

    const { result } = renderHook(() => useNotesPendingSync("bob"));

    await waitFor(() => expect(result.current.has("body-1")).toBe(true));
    expect(result.current.has("meta-1")).toBe(true);
    expect(result.current.size).toBe(2);
  });
});
