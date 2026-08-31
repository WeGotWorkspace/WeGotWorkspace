import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useContactsAPI } from "./use-contacts-api";
import type { ContactsApiSource } from "./contacts-api-source";

const mockPatchBootstrap = vi.fn();
const mockLoadBootstrap = vi.fn();
const mockFlush = vi.fn();
const initialize = vi.fn();
const startPolling = vi.fn();
const stopPolling = vi.fn();
let mockLiveApi = false;

const bootstrap = createContactsAppBootstrap({
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: "alice" },
  },
});

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

vi.mock("@/lib/offline/contacts-hybrid-operations", () => ({
  createHybridContactsOperations: vi.fn(),
  getContactsSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/use-offline-reconnect-flush", () => ({
  useOfflineReconnectFlush: () => false,
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: (callback: () => void) => {
    callback();
  },
}));

vi.mock("@/lib/offline/contacts-offline-store", () => ({
  readContactsBootstrapFromCache: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/offline/contacts-jmap-inbound", () => ({
  ingestRemoteContactCard: vi.fn(),
  ingestRemoteContactCardDestroyed: vi.fn(),
  ingestRemoteAddressBook: vi.fn(),
  ingestRemoteAddressBookDestroyed: vi.fn(),
  reconcileContactsSnapshot: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return { ...actual, wgwLiveApiEnabled: () => mockLiveApi };
});

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return { ...actual, createContactsJmapClient: () => ({}) };
});

vi.mock("@/lib/jmap-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jmap-client")>();
  return {
    ...actual,
    JmapContactsAdapter: class {
      initialize = initialize;
      startPolling = startPolling;
      stopPolling = stopPolling;
    },
  };
});

describe("useContactsAPI", () => {
  beforeEach(() => {
    mockPatchBootstrap.mockReset();
    mockLoadBootstrap.mockReset();
    mockFlush.mockReset();
    mockFlush.mockResolvedValue({ stateMismatches: [], bootstrap: null });
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    initialize.mockReset();
    startPolling.mockReset();
    stopPolling.mockReset();
    initialize.mockResolvedValue(undefined);
    mockLiveApi = false;
  });

  it("refreshList reloads bootstrap and patches workspace data", async () => {
    const source: ContactsApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useContactsAPI(source));

    act(() => {
      result.current.refreshList();
    });

    expect(result.current.listLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.listLoading).toBe(false);
    });

    expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap.mock.calls[0]?.[0]()).toEqual(bootstrap);
  });

  it("starts one inbound JMAP poll loop after initialize", async () => {
    mockLiveApi = true;
    const source: ContactsApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useContactsAPI(source));

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(startPolling).toHaveBeenCalledTimes(1);
    });
  });

  it("forwards sync conflicts reported during bootstrap flush", async () => {
    const onSyncConflict = vi.fn();
    const source: ContactsApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useContactsAPI(source, { onSyncConflict }));

    const { reportContactsSyncConflicts } = await import("@/lib/offline/contacts-sync-conflicts");
    reportContactsSyncConflicts(["jane-doe"]);

    expect(onSyncConflict).toHaveBeenCalledWith(["jane-doe"]);
  });
});
