import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/notes-offline-store", () => ({
  listFailedNotesOutbox: vi.fn(),
}));

import { listFailedNotesOutbox } from "@/lib/offline/notes-offline-store";
import { useNotesFailedSync } from "@/notes-core/src/use-notes-failed-sync";

describe("useNotesFailedSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 and skips the read when no username is known", () => {
    const { result } = renderHook(() => useNotesFailedSync(undefined));
    expect(result.current).toBe(0);
    expect(listFailedNotesOutbox).not.toHaveBeenCalled();
  });

  it("counts the failed outbox rows for the account", async () => {
    vi.mocked(listFailedNotesOutbox).mockResolvedValue([
      {
        id: "a",
        domain: "notes",
        op: "upsert",
        payload: "{}",
        createdAt: 1,
        retries: 2,
        lastError: "boom",
      },
      {
        id: "b",
        domain: "notes",
        op: "upsert",
        payload: "{}",
        createdAt: 2,
        retries: 1,
        lastError: "boom",
      },
    ]);
    const { result } = renderHook(() => useNotesFailedSync("bob"));
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("counts metadata conflict ids when the outbox has no retryable rows", async () => {
    vi.mocked(listFailedNotesOutbox).mockResolvedValue([]);
    const { result } = renderHook(() => useNotesFailedSync("bob", 0, ["note-1", "note-2"]));
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("adds metadata conflict ids to the retryable outbox count", async () => {
    vi.mocked(listFailedNotesOutbox).mockResolvedValue([
      {
        id: "a",
        domain: "notes",
        op: "upsert",
        payload: "{}",
        createdAt: 1,
        retries: 1,
        lastError: "boom",
      },
    ]);
    const { result } = renderHook(() => useNotesFailedSync("bob", 0, ["note-9"]));
    await waitFor(() => expect(result.current).toBe(2));
  });
});
