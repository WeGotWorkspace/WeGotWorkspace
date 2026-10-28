import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNotesAppBootstrap, type NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useNotesAPI } from "./use-notes-api";
import type { NotesApiSource } from "./notes-api-source";

// Runs the real hybrid bootstrap (cache first, then network) so the tests
// cover what the list shows on first load and on reconnect (#1532).

const USERNAME = "demo@example.com";
const bootstrap = createNotesAppBootstrap({
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: USERNAME },
  },
});

const mockReadCache = vi.fn<() => Promise<NotesAppBootstrap | null>>();
const mockLoadBootstrap = vi.fn<() => Promise<NotesAppBootstrap>>();
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();

vi.mock("@/lib/offline/offline-session", () => ({
  readOfflineNotesUsername: () => USERNAME,
  resolveNotesOfflineUsername: (sessionUsername?: string) => sessionUsername ?? USERNAME,
}));

vi.mock("@/lib/offline/notes-offline-store", () => ({
  readNotesBootstrapFromCache: () => mockReadCache(),
  listNoteIdsBlockingSyncToken: async () => new Set<string>(),
}));

vi.mock("@/lib/offline/notes-hybrid-operations", () => ({
  createHybridNotesOperations: vi.fn(),
  getNotesSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/notes-inbound-sync", () => ({
  syncNotesInboundFromRest: async () => ({ changed: false, usedFullResync: false }),
}));

vi.mock("@/lib/offline/notes-bootstrap-sync", () => ({
  notifyNotesBootstrapUpdated: vi.fn(),
  subscribeNotesBootstrapUpdated: vi.fn(() => () => undefined),
}));

vi.mock("./notes-pending-bodies", () => ({ uploadPendingNoteBodies: async () => undefined }));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return {
    ...actual,
    wgwLiveApiEnabled: () => false,
    wgwAwaitSessionRefreshForReconnect: async () => undefined,
  };
});

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const source: NotesApiSource = {
  loadBootstrap: () => mockLoadBootstrap(),
  createOperations: () => undefined,
};

describe("useNotesAPI list loading", () => {
  beforeEach(() => {
    mockReadCache.mockReset();
    mockLoadBootstrap.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue({ stateMismatches: [], bootstrap: null });
    mockLoadBootstrap.mockResolvedValue(bootstrap);
  });

  it("keeps cached notes on screen and out of the loading state while a reconnect syncs", async () => {
    expect(bootstrap.data.notes.length).toBeGreaterThan(0);
    mockReadCache.mockResolvedValue(bootstrap);

    const { result } = renderHook(() => useNotesAPI(source));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.listLoading).toBe(false);

    const flush = deferred<{ stateMismatches: never[]; bootstrap: null }>();
    mockFlush.mockReturnValueOnce(flush.promise);

    await act(async () => {
      mockOnReconnect();
    });
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));

    expect(result.current.syncing).toBe(true);
    expect(result.current.listLoading).toBe(false);
    expect(result.current.listRefreshing).toBe(true);
    expect(result.current.data.notes).toEqual(bootstrap.data.notes);

    await act(async () => {
      flush.resolve({ stateMismatches: [], bootstrap: null });
    });
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(result.current.listLoading).toBe(false);
    expect(result.current.listRefreshing).toBe(false);
    expect(result.current.data.notes).toEqual(bootstrap.data.notes);
  });

  it("shows the loading state on a first load with an empty cache", async () => {
    mockReadCache.mockResolvedValue(null);
    const load = deferred<NotesAppBootstrap>();
    mockLoadBootstrap.mockReturnValueOnce(load.promise);

    const { result } = renderHook(() => useNotesAPI(source));
    await waitFor(() => expect(mockLoadBootstrap).toHaveBeenCalledTimes(1));

    expect(result.current.listLoading).toBe(true);
    expect(result.current.data.notes).toEqual([]);

    await act(async () => {
      load.resolve(bootstrap);
    });
    await waitFor(() => expect(result.current.listLoading).toBe(false));
    expect(result.current.data.notes).toEqual(bootstrap.data.notes);
  });
});
