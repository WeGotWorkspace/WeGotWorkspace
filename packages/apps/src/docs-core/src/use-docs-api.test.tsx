import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useDocsAPI } from "./use-docs-api";
import type { DocsApiSource } from "./docs-api-source";

const bootstrap = createDocsAppBootstrap({
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
  },
});

const mockLoadBootstrap = vi.fn();
const mockHybridLoad = vi.fn();

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: mockHybridLoad,
    successVersion: 1,
  }),
}));

const { order, mockFlush, mockSyncBodies, mockOnline } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    mockFlush: vi.fn(async () => {
      order.push("flush");
    }),
    mockSyncBodies: vi.fn(async () => {
      order.push("sync");
    }),
    mockOnline: vi.fn(() => true),
  };
});

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  resolveDocsOfflineUsername: (username?: string) => username,
}));
vi.mock("@/lib/offline/docs/docs-hybrid-operations", () => ({
  getDocsSyncRunner: () => ({ flush: mockFlush }),
}));
vi.mock("@/docs-core/src/docs-pending-bodies", () => ({
  uploadPendingDocBodies: vi.fn(async () => {
    order.push("bodies");
  }),
}));
vi.mock("@/lib/offline/docs/docs-body-sync", () => ({
  syncDocsBodiesFromHomeListing: mockSyncBodies,
}));
vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => mockOnline(),
}));

const mockNetworkOperations = {
  loadFile: vi.fn(),
  saveFile: vi.fn(),
  renameFile: vi.fn(),
};

describe("useDocsAPI", () => {
  beforeEach(() => {
    mockLoadBootstrap.mockReset();
    mockHybridLoad.mockReset();
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    mockFlush.mockClear();
    mockSyncBodies.mockClear();
    mockOnline.mockReturnValue(true);
    order.length = 0;
  });

  const source = (): DocsApiSource => ({
    loadBootstrap: mockLoadBootstrap,
    createNetworkOperations: () => mockNetworkOperations,
    createOperations: () => undefined,
  });

  it("sends changes queued offline, then left bodies, on load on any Docs page, before syncing", async () => {
    renderHook(() => useDocsAPI(source()));

    await waitFor(() => expect(order).toEqual(["flush", "bodies", "sync"]));
  });

  it("keeps changes queued while the browser is offline", async () => {
    mockOnline.mockReturnValue(false);
    renderHook(() => useDocsAPI(source()));

    await waitFor(() => expect(mockSyncBodies).toHaveBeenCalled());
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("returns bootstrap data and network operations", async () => {
    const source: DocsApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createNetworkOperations: () => mockNetworkOperations,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useDocsAPI(source));

    await waitFor(() => expect(result.current.session.user.username).toBe("demo@example.com"));
    expect(result.current.data).toEqual(bootstrap.data);
    expect(result.current.networkOperations).toBe(mockNetworkOperations);
    expect(result.current.successVersion).toBe(1);
  });

  it("exposes retry from hybrid bootstrap", async () => {
    const source: DocsApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createNetworkOperations: () => mockNetworkOperations,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useDocsAPI(source));

    await act(async () => {
      result.current.retry();
    });
    expect(mockHybridLoad).toHaveBeenCalledTimes(1);
  });
});
