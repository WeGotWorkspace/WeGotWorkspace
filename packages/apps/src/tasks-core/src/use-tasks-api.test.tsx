import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import { useTasksAPI } from "./use-tasks-api";
import type { TasksApiSource } from "./tasks-api-source";

const bootstrap = {
  ...createTasksAppBootstrap(),
  session: {
    ...mockWorkspaceSession,
    user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
  },
};
const mockPatchBootstrap = vi.fn();
const mockLoadBootstrap = vi.fn();
const mockShow = vi.fn();
const mockShowError = vi.fn();
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();

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

vi.mock("@/lib/offline/tasks-hybrid-operations", () => ({
  createHybridTasksOperations: vi.fn(),
  getTasksSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/tasks-offline-store", () => ({
  readTasksBootstrapFromCache: vi.fn(async () => bootstrap),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return { ...actual, wgwAwaitSessionRefreshForReconnect: async () => undefined };
});

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: mockShow,
    showError: mockShowError,
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

describe("useTasksAPI", () => {
  beforeEach(() => {
    mockPatchBootstrap.mockReset();
    mockLoadBootstrap.mockReset();
    mockShow.mockReset();
    mockShowError.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    mockFlush.mockResolvedValue(undefined);
  });

  it("keeps the list out of the loading state while a reconnect syncs (#1532)", async () => {
    let finishFlush!: () => void;
    mockFlush.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishFlush = resolve;
      }),
    );
    const source: TasksApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useTasksAPI(source));

    await act(async () => {
      mockOnReconnect();
    });
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));

    expect(result.current.listLoading).toBe(false);
    expect(result.current.listRefreshing).toBe(true);
    expect(result.current.data.tasks).toEqual(bootstrap.data.tasks);

    await act(async () => {
      finishFlush();
    });
    await waitFor(() => expect(result.current.listRefreshing).toBe(false));
    expect(result.current.listLoading).toBe(false);
  });

  it("refreshList reloads bootstrap in the background without list loading state", async () => {
    const source: TasksApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useTasksAPI(source));

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
    expect(mockShow).toHaveBeenCalledWith(
      defaultTasksLabels.toastListUpdated,
      expect.objectContaining({ icon: expect.anything() }),
    );
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it("refreshList shows an error toast when bootstrap reload fails", async () => {
    mockLoadBootstrap.mockRejectedValue(new Error("network"));
    const source: TasksApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useTasksAPI(source));

    act(() => {
      result.current.refreshList();
    });

    await waitFor(() => {
      expect(result.current.listRefreshing).toBe(false);
    });

    expect(mockShow).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith(defaultTasksLabels.toastListRefreshFailed);
  });
});
