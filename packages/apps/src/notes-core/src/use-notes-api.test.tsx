import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useNotesAPI } from "./use-notes-api";
import type { NotesApiSource } from "./notes-api-source";

const bootstrap = createNotesAppBootstrap({
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
  },
});

const mockPatchBootstrap = vi.fn();
const mockLoadBootstrap = vi.fn();
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();
let mockOnline = true;

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: vi.fn(),
    successVersion: 1,
    patchBootstrap: mockPatchBootstrap,
  }),
}));

vi.mock("@/lib/offline/notes-hybrid-operations", () => ({
  createHybridNotesOperations: vi.fn(),
  getNotesSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/notes-offline-store", () => ({
  readNotesBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/notes-bootstrap-sync", () => ({
  notifyNotesBootstrapUpdated: vi.fn(),
  subscribeNotesBootstrapUpdated: vi.fn(() => () => undefined),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: mockOnline }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

describe("useNotesAPI", () => {
  beforeEach(async () => {
    mockOnline = true;
    mockPatchBootstrap.mockReset();
    mockLoadBootstrap.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue({ stateMismatches: [], bootstrap: null });
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    const { readNotesBootstrapFromCache } = await import("@/lib/offline/notes-offline-store");
    vi.mocked(readNotesBootstrapFromCache).mockResolvedValue(bootstrap);
    vi.useRealTimers();
  });

  it("refreshList reloads bootstrap in the background without list loading state", async () => {
    const source: NotesApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useNotesAPI(source));

    act(() => {
      result.current.refreshList();
    });

    expect(result.current.listLoading).toBe(false);
    expect(result.current.listRefreshing).toBe(true);

    await waitFor(() => {
      expect(result.current.listRefreshing).toBe(false);
    });

    expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap.mock.calls[0]?.[0]()).toEqual(bootstrap);
    expect(result.current.bootstrapRevision).toBe(1);
    expect(result.current.listLoading).toBe(false);
  });

  it("flushes the outbox, reloads bootstrap, and notifies other tabs on reconnect", async () => {
    const source: NotesApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useNotesAPI(source));

    await act(async () => {
      mockOnReconnect();
    });

    const { notifyNotesBootstrapUpdated } = await import("@/lib/offline/notes-bootstrap-sync");

    await waitFor(() => {
      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
      expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
      expect(mockPatchBootstrap.mock.calls[0]?.[0]()).toEqual(bootstrap);
      expect(notifyNotesBootstrapUpdated).toHaveBeenCalledWith("demo@example.com");
    });
  });

  it("forwards sync conflicts reported during bootstrap flush", async () => {
    const onSyncConflict = vi.fn();
    const source: NotesApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useNotesAPI(source, { onSyncConflict }));

    const { reportNotesSyncConflicts } = await import("@/lib/offline/notes-sync-conflicts");
    reportNotesSyncConflicts(["note-1"]);

    expect(onSyncConflict).toHaveBeenCalledWith(["note-1"]);
  });

  it("silently reloads bootstrap on an interval while online", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });

    const source: NotesApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useNotesAPI(source));

    expect(mockLoadBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
    expect(result.current.listLoading).toBe(false);
    expect(result.current.bootstrapRevision).toBe(1);
  });

  it("does not poll bootstrap while offline", async () => {
    vi.useFakeTimers();
    mockOnline = false;
    Object.defineProperty(document, "hidden", { configurable: true, value: false });

    const source: NotesApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useNotesAPI(source));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mockLoadBootstrap).not.toHaveBeenCalled();
  });
});
