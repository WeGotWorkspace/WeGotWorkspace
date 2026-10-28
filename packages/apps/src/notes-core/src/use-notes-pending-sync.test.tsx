import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/notes-offline-store", () => ({
  listPendingNoteIds: vi.fn(),
  readNotesBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/notes/notes-collab-rooms", () => ({
  hasNoteCollabPendingServerSave: vi.fn(),
  noteCollabRoomKey: (uid: string) => uid,
}));

vi.mock("@/text-editor-core/docs-collab/docs-collab-persistence", () => ({
  listExistingIndexedDatabaseNames: vi.fn(async () => null),
}));

import { hasNoteCollabPendingServerSave } from "@/lib/offline/notes/notes-collab-rooms";
import { listPendingNoteIds, readNotesBootstrapFromCache } from "@/lib/offline/notes-offline-store";
import {
  isCollabRoomPendingServerSave,
  setCollabRoomPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-pending-registry";
import { useNotesPendingSync } from "@/notes-core/src/use-notes-pending-sync";
import { listExistingIndexedDatabaseNames } from "@/text-editor-core/docs-collab/docs-collab-persistence";

describe("useNotesPendingSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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

  it("lists IndexedDB databases once per refresh", async () => {
    vi.mocked(listPendingNoteIds).mockResolvedValue([]);
    vi.mocked(readNotesBootstrapFromCache).mockResolvedValue({
      data: { notes: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    } as never);

    renderHook(() => useNotesPendingSync("bob"));

    await waitFor(() => expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(3));
    expect(listExistingIndexedDatabaseNames).toHaveBeenCalledTimes(1);
    expect(hasNoteCollabPendingServerSave).toHaveBeenNthCalledWith(1, "a", null);
    expect(hasNoteCollabPendingServerSave).toHaveBeenNthCalledWith(2, "b", null);
    expect(hasNoteCollabPendingServerSave).toHaveBeenNthCalledWith(3, "c", null);
  });

  it("does not open a database per note on later polls, and follows the shared record", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const notes = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}` }));
      vi.mocked(listPendingNoteIds).mockResolvedValue([]);
      vi.mocked(readNotesBootstrapFromCache).mockResolvedValue({ data: { notes } } as never);
      vi.mocked(hasNoteCollabPendingServerSave).mockImplementation(async (uid) => uid === "n5");

      const { result } = renderHook(() => useNotesPendingSync("bob"));
      await waitFor(() => expect(result.current.has("n5")).toBe(true));
      expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(1000);
      vi.mocked(hasNoteCollabPendingServerSave).mockClear();

      // A save is marked pending, then lands: the next poll ticks pick both up.
      setCollabRoomPendingServerSave("n7", true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      await waitFor(() => expect(result.current.has("n7")).toBe(true));
      setCollabRoomPendingServerSave("n7", false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      await waitFor(() => expect(result.current.has("n7")).toBe(false));

      expect(result.current.has("n5")).toBe(true);
      expect(hasNoteCollabPendingServerSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("claims the seed before any read finishes, and keeps a record changed during the read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(listPendingNoteIds).mockResolvedValue([]);
      vi.mocked(readNotesBootstrapFromCache).mockResolvedValue({
        data: { notes: [{ id: "a" }, { id: "b" }] },
      } as never);
      let release: (value: boolean) => void = () => undefined;
      vi.mocked(hasNoteCollabPendingServerSave).mockImplementation(
        (uid) =>
          new Promise<boolean>((resolve) => (uid === "a" ? (release = resolve) : resolve(false))),
      );

      const { result } = renderHook(() => useNotesPendingSync("bob"));
      await waitFor(() => expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(1));

      // Two more polls while the read is open do not scan again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8200);
      });
      expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(1);
      expect(listExistingIndexedDatabaseNames).toHaveBeenCalledTimes(1);

      // A save marks the room pending during the read; the stale result must not undo it.
      setCollabRoomPendingServerSave("a", true);
      release(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      await waitFor(() => expect(result.current.has("a")).toBe(true));
      expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a clear that changed nothing during the read (room absent from the record)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(listPendingNoteIds).mockResolvedValue([]);
      vi.mocked(readNotesBootstrapFromCache).mockResolvedValue({
        data: { notes: [{ id: "z" }] },
      } as never);
      let release: (value: boolean) => void = () => undefined;
      vi.mocked(hasNoteCollabPendingServerSave).mockImplementation(
        () => new Promise<boolean>((resolve) => (release = resolve)),
      );

      const { result } = renderHook(() => useNotesPendingSync("carol"));
      await waitFor(() => expect(hasNoteCollabPendingServerSave).toHaveBeenCalledTimes(1));

      // A finished save clears a room that was never stored; the read saw the old flag.
      setCollabRoomPendingServerSave("z", false);
      release(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      expect(isCollabRoomPendingServerSave("z")).toBe(false);
      expect(result.current.has("z")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
