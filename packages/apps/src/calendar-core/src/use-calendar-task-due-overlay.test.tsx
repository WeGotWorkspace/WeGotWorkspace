import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TasksUIData } from "@/tasks-core/src/tasks-types";
import { useCalendarTaskDueOverlay } from "@/calendar-core/src/use-calendar-task-due-overlay";

const mockLoadHybrid = vi.fn();
const mockReadCache = vi.fn();
const mockReadUsername = vi.fn(() => "demo");
const mockOnReconnect = vi.fn();

vi.mock("@/lib/offline/tasks-hybrid-operations", () => ({
  loadTasksBootstrapHybrid: () => mockLoadHybrid(),
}));

vi.mock("@/lib/offline/tasks-offline-store", () => ({
  readTasksBootstrapFromCache: (...args: unknown[]) => mockReadCache(...args),
}));

vi.mock("@/lib/offline/offline-session", () => ({
  readOfflineTasksUsername: () => mockReadUsername(),
}));

const mockReadOnline = vi.fn(() => true);

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => mockReadOnline(),
}));

vi.mock("@/lib/offline/use-offline-reconnect-flush", () => ({
  useOfflineReconnectFlush: ({
    enabled,
    flush,
  }: {
    enabled: boolean;
    flush: () => Promise<void>;
  }) => {
    mockOnReconnect.mockImplementation(() => {
      if (!enabled) return;
      void flush();
    });
    return false;
  },
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

describe("useCalendarTaskDueOverlay", () => {
  beforeEach(() => {
    mockLoadHybrid.mockReset();
    mockReadCache.mockReset();
    mockOnReconnect.mockReset();
    mockReadOnline.mockReset();
    mockReadOnline.mockReturnValue(true);
    mockReadCache.mockResolvedValue(null);
    mockLoadHybrid.mockResolvedValue({ data: preset, session: {} });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("uses a preset without calling Tasks hybrid bootstrap", async () => {
    const { result } = renderHook(() =>
      useCalendarTaskDueOverlay({ preset, hiddenListIds: new Set() }),
    );
    await act(async () => undefined);
    expect(mockLoadHybrid).not.toHaveBeenCalled();
    expect(result.current.overlayEvents.has("task:milk")).toBe(true);
  });

  it("hydrates from hybrid bootstrap and remaps after visibilitychange", async () => {
    const later: TasksUIData = {
      ...preset,
      tasks: [
        ...preset.tasks,
        {
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
        },
      ],
    };
    mockLoadHybrid.mockResolvedValueOnce({ data: preset, session: {} }).mockResolvedValueOnce({
      data: later,
      session: {},
    });

    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));

    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    expect(result.current.overlayEvents.has("task:spec")).toBe(false);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:spec")).toBe(true);
    });
    expect(mockLoadHybrid).toHaveBeenCalledTimes(2);
  });

  it("does not refresh while the tab is hidden", async () => {
    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));
    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    mockLoadHybrid.mockClear();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mockLoadHybrid).not.toHaveBeenCalled();
  });

  it("paints Dexie cache before live hybrid resolves", async () => {
    mockReadCache.mockResolvedValue({ data: preset, session: {} });
    mockLoadHybrid.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));

    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
    });
    expect(result.current.taskLists).toHaveLength(1);
    expect(mockLoadHybrid).toHaveBeenCalled();
  });

  it("skips live hybrid when cache painted while offline", async () => {
    mockReadOnline.mockReturnValue(false);
    mockReadCache.mockResolvedValue({ data: preset, session: {} });

    const { result } = renderHook(() => useCalendarTaskDueOverlay({ hiddenListIds: new Set() }));

    await waitFor(() => {
      expect(result.current.overlayEvents.has("task:milk")).toBe(true);
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
