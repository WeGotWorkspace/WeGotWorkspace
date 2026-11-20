import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TasksUIData } from "@/lib/models/tasks-types";
import { useCalendarTaskDueOverlay } from "@/calendar-core/src/use-calendar-task-due-overlay";

const mockLoadHybrid = vi.fn();
const mockReadCache = vi.fn();
const mockReadUsername = vi.fn(() => "demo");
const mockReadOnline = vi.fn(() => true);
const mockLiveInbound = vi.fn();
let cacheUpdated: (() => void) | null = null;

vi.mock("@/lib/offline/tasks/tasks-hybrid-operations", () => ({
  loadTasksBootstrapHybrid: () => mockLoadHybrid(),
}));

vi.mock("@/lib/offline/tasks/tasks-offline-store", () => ({
  readTasksBootstrapFromCache: (...args: unknown[]) => mockReadCache(...args),
}));

vi.mock("@/lib/offline/core/offline-session", () => ({
  readOfflineTasksUsername: () => mockReadUsername(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => mockReadOnline(),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: mockReadOnline() }),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: () => true,
}));

vi.mock("@/lib/offline/tasks/tasks-bootstrap-sync", () => ({
  subscribeTasksBootstrapUpdated: (_username: string, onChange: () => void) => {
    cacheUpdated = onChange;
    return () => {
      cacheUpdated = null;
    };
  },
}));

vi.mock("@/lib/offline/tasks/use-tasks-live-inbound", () => ({
  useTasksLiveInbound: (args: unknown) => mockLiveInbound(args),
}));

const preset: TasksUIData = {
  taskLists: [
    {
      id: "errands",
      name: "Errands",
      color: "#6366f1",
      sortOrder: 0,
      isDefault: false,
      isSubscribed: true,
      shareWith: null,
      isSharee: false,
      myRights: {
        mayReadItems: true,
        mayWriteAll: true,
        mayWriteOwn: true,
        mayUpdatePrivate: true,
        mayRSVP: true,
        mayAdmin: true,
        mayDelete: true,
        mayShare: true,
      },
      scope: "personal",
      groupSlug: null,
    },
  ],
  tasks: [
    {
      "@type": "Task",
      id: "milk",
      taskListId: "errands",
      uid: "urn:uuid:milk",
      title: "Buy milk",
      due: "2033-01-12",
      showWithoutTime: true,
      workflowStatus: "needs-action",
      isDraft: false,
      sortOrder: 0,
      categories: [],
    },
  ],
};

const spec = {
  "@type": "Task",
  id: "spec",
  taskListId: "errands",
  uid: "urn:uuid:spec",
  title: "Review spec",
  due: "2033-01-12T14:00:00",
  showWithoutTime: false,
  workflowStatus: "needs-action",
  isDraft: false,
  sortOrder: 1,
  categories: [],
} as TasksUIData["tasks"][number];

describe("useCalendarTaskDueOverlay", () => {
  beforeEach(() => {
    mockLoadHybrid.mockReset();
    mockReadCache.mockReset();
    mockLiveInbound.mockReset();
    mockReadOnline.mockReset();
    mockReadOnline.mockReturnValue(true);
    mockReadCache.mockResolvedValue(null);
    mockLoadHybrid.mockResolvedValue({ data: preset, session: { user: { username: "demo" } } });
    cacheUpdated = null;
  });

  it("uses a preset without loading Tasks or starting the live sync", async () => {
    const { result } = renderHook(() =>
      useCalendarTaskDueOverlay({ preset, hiddenListIds: new Set() }),
    );
    await act(async () => undefined);
    expect(mockLoadHybrid).not.toHaveBeenCalled();
    expect(mockLiveInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: null, enabled: false }),
    );
    expect(result.current.overlayEvents.has("task:milk")).toBe(true);
  });

  it("paints the cache and sends no full load when there is one", async () => {
    mockReadCache.mockResolvedValue({ data: preset, session: {} });
    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));
    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    expect(result.current.taskLists).toHaveLength(1);
    expect(mockLoadHybrid).not.toHaveBeenCalled();
  });

  it("loads Tasks once without a cache, and showing the tab again reloads nothing", async () => {
    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));
    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(mockLoadHybrid).toHaveBeenCalledTimes(1);
  });

  it("does not load Tasks offline without a cache", async () => {
    mockReadOnline.mockReturnValue(false);
    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));
    await act(async () => undefined);
    expect(mockLoadHybrid).not.toHaveBeenCalled();
    expect(result.current.overlayEvents.size).toBe(0);
    expect(mockLiveInbound).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("re-reads the cache when the Tasks app or the live sync updates it", async () => {
    mockReadCache.mockResolvedValue({ data: preset, session: {} });
    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));
    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    expect(mockLiveInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: "demo", enabled: true }),
    );

    mockReadCache.mockResolvedValue({
      data: { ...preset, tasks: [...preset.tasks, spec] },
      session: {},
    });
    await act(async () => {
      cacheUpdated?.();
    });
    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:spec")).toBe(true);
    });
    expect(mockLoadHybrid).not.toHaveBeenCalled();
  });

  it("omits hidden lists from mapped overlay events", () => {
    const { result } = renderHook(() =>
      useCalendarTaskDueOverlay({
        preset,
        hiddenListIds: new Set(["errands"]),
      }),
    );
    expect(result.current.overlayEvents.size).toBe(0);
    expect(result.current.taskLists).toHaveLength(1);
  });
});
