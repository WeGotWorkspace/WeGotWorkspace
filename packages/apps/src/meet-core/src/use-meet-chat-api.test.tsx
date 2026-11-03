import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useMeetChatAPI } from "./use-meet-chat-api";

const bootstrap = {
  ...createMeetAppBootstrap(),
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
  },
};
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: vi.fn(),
    successVersion: 1,
    patchBootstrap: vi.fn(),
  }),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return {
    ...actual,
    wgwLiveApiEnabled: () => true,
    wgwAwaitSessionRefreshForReconnect: async () => undefined,
  };
});

vi.mock("@/lib/offline/offline-session", () => ({
  readOfflineMeetChatUsername: () => "demo@example.com",
  resolveMeetChatOfflineUsername: (username: string | undefined) => username ?? null,
}));

vi.mock("@/lib/offline/meet-chat-hybrid-operations", () => ({
  getMeetChatSyncRunner: () => ({ flush: mockFlush }),
  meetChatBootstrapFromCached: vi.fn(),
}));

vi.mock("@/lib/offline/meet-chat-offline-store", () => ({
  readMeetChatBootstrapFromCache: vi.fn(async () => null),
  isChatChannelBackfilled: vi.fn(async () => true),
}));

vi.mock("@/lib/offline/meet-chat-inbound-sync", () => ({
  syncMeetChatInboundFromRest: vi.fn(async () => undefined),
  backfillChatChannelHistory: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/wgw/meet-chat-jmap", () => ({
  createMeetChatJmapClient: vi.fn(),
}));

vi.mock("@/lib/jmap-client", () => ({
  JmapChatAdapter: class {
    initialize = async () => undefined;
    startPolling = vi.fn();
    stopPolling = vi.fn();
  },
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

describe("useMeetChatAPI", () => {
  beforeEach(() => {
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue(undefined);
  });

  it("keeps the list out of the loading state while a reconnect syncs (#1532)", async () => {
    let finishFlush!: () => void;
    mockFlush.mockReturnValue(
      new Promise<void>((resolve) => {
        finishFlush = resolve;
      }),
    );

    const { result } = renderHook(() =>
      useMeetChatAPI({ loadBootstrap: vi.fn(), createOperations: () => undefined }),
    );
    expect(bootstrap.data.channels?.length).toBeGreaterThan(0);

    await act(async () => {
      mockOnReconnect();
    });
    await waitFor(() => expect(result.current.syncing).toBe(true));

    expect(result.current.listLoading).toBe(false);
    expect(result.current.data.channels).toEqual(bootstrap.data.channels);

    await act(async () => {
      finishFlush();
    });
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(result.current.listLoading).toBe(false);
  });
});
