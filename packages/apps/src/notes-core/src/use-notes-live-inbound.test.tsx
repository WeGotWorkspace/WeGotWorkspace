import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JmapNote, JmapNotesAdapterOptions } from "@/lib/jmap-client";
import type { Note } from "@/lib/models/note";
import { holdNoteBodyRoom } from "./note-body-rooms";
import {
  NOTES_CHANGES_POLL_MS,
  NOTES_CHANGES_PUSH_POLL_MS,
  useNotesLiveInbound,
} from "./use-notes-live-inbound";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  syncIfStale: vi.fn(),
  options: null as JmapNotesAdapterOptions | null,
  pushConnected: false,
  subscribedTypes: [] as string[],
  listener: null as ((states: Record<string, string>, accountId: string) => unknown) | null,
  ingestRemoteNote: vi.fn(),
  getNoteFromCache: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return { ...actual, wgwLiveApiEnabled: () => true };
});

vi.mock("@/lib/api/wgw/notes-jmap", () => ({ createNotesJmapClient: () => ({}) }));

vi.mock("@/lib/jmap-client", () => ({
  JmapNotesAdapter: class {
    constructor(options: JmapNotesAdapterOptions) {
      mocks.options = options;
    }
    initialize() {
      return mocks.initialize();
    }
    startPolling(intervalMs: number) {
      mocks.startPolling(intervalMs);
    }
    stopPolling() {
      mocks.stopPolling();
    }
    syncIfStale(states: Record<string, string>, accountId?: string) {
      return mocks.syncIfStale(states, accountId);
    }
  },
}));

vi.mock("@/lib/api/wgw/use-jmap-state-change", () => ({
  useJmapPushConnected: () => mocks.pushConnected,
  useJmapStateChange: (
    types: readonly string[],
    listener: (states: Record<string, string>, accountId: string) => unknown,
  ) => {
    mocks.subscribedTypes = [...types];
    mocks.listener = listener;
  },
}));

vi.mock("@/lib/offline/notes-jmap-inbound", () => ({
  ingestRemoteNote: mocks.ingestRemoteNote,
  ingestRemoteNoteDestroyed: vi.fn(async () => "removed"),
  ingestRemoteNotebook: vi.fn(async () => undefined),
  ingestRemoteNotebookDestroyed: vi.fn(async () => undefined),
  reconcileNotesSnapshot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/offline/notes-offline-store", () => ({
  getNoteFromCache: mocks.getNoteFromCache,
  listNoteIdsBlockingSyncToken: vi.fn(async () => new Set()),
}));

const notebooks = { current: [] };

function renderLiveInbound(patchFromCache = vi.fn(async () => undefined)) {
  return renderHook(() =>
    useNotesLiveInbound({ username: "admin", enabled: true, notebooks, patchFromCache }),
  );
}

describe("useNotesLiveInbound", () => {
  beforeEach(() => {
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.startPolling.mockReset();
    mocks.stopPolling.mockReset();
    mocks.syncIfStale.mockReset().mockResolvedValue(true);
    mocks.ingestRemoteNote.mockReset().mockResolvedValue("upserted");
    mocks.getNoteFromCache.mockReset().mockResolvedValue(null);
    mocks.options = null;
    mocks.pushConnected = false;
    mocks.subscribedTypes = [];
    mocks.listener = null;
  });

  it("subscribes to Note and Notebook only once the adapter is ready", async () => {
    let ready: () => void = () => undefined;
    mocks.initialize.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
    const { result } = renderLiveInbound();
    expect(mocks.subscribedTypes).toEqual([]);

    await act(async () => ready());

    expect(result.current).toBe(true);
    expect(mocks.subscribedTypes).toEqual(["Note", "Notebook"]);
  });

  it("syncs on a push and reports whether the sync succeeded", async () => {
    renderLiveInbound();
    await waitFor(() => expect(mocks.subscribedTypes).toEqual(["Note", "Notebook"]));

    mocks.syncIfStale.mockResolvedValueOnce(false);
    const confirmed = await mocks.listener?.({ Note: "s2" }, "admin");

    expect(mocks.syncIfStale).toHaveBeenCalledWith({ Note: "s2" }, "admin");
    expect(confirmed).toBe(false);
  });

  it("polls every 10 s without push and every 60 s while push is connected", async () => {
    const { rerender } = renderLiveInbound();
    await waitFor(() => expect(mocks.startPolling).toHaveBeenCalledWith(NOTES_CHANGES_POLL_MS));

    mocks.pushConnected = true;
    rerender();

    expect(mocks.startPolling).toHaveBeenLastCalledWith(NOTES_CHANGES_PUSH_POLL_MS);
  });

  it("returns false when JMAP is unavailable, so the REST interval runs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.initialize.mockRejectedValue(new Error("no notes capability"));
    const { result } = renderLiveInbound();

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toBe(false);
    expect(mocks.subscribedTypes).toEqual([]);
    warn.mockRestore();
  });

  it("keeps the cached body when a note comes without one", async () => {
    const cached = {
      id: "n-1",
      body: ["typed in the room"],
      excerpt: "typed in the room",
      wordCount: 4,
    } as Partial<Note>;
    mocks.getNoteFromCache.mockResolvedValue(cached);
    renderLiveInbound();
    await waitFor(() => expect(mocks.options).not.toBeNull());

    const metadataOnly: JmapNote = {
      id: "n-1",
      notebookId: "nb",
      title: "Tagged",
      categories: ["x"],
    };
    mocks.options?.onRemoteNote?.(metadataOnly);

    await waitFor(() => expect(mocks.ingestRemoteNote).toHaveBeenCalled());
    const ingested = mocks.ingestRemoteNote.mock.calls[0]?.[1] as Note;
    expect(ingested.title).toBe("Tagged");
    expect(ingested.tags).toEqual(["x"]);
    expect(ingested.body).toEqual(["typed in the room"]);
    expect(ingested.excerpt).toBe("typed in the room");
  });

  it("asks the adapter to skip the body of a note whose room is open", async () => {
    renderLiveInbound();
    await waitFor(() => expect(mocks.options).not.toBeNull());

    expect(mocks.options?.bodyInRoom?.("n-open")).toBe(false);
    const release = holdNoteBodyRoom("n-open");
    expect(mocks.options?.bodyInRoom?.("n-open")).toBe(true);
    release();
    expect(mocks.options?.bodyInRoom?.("n-open")).toBe(false);
  });
});
