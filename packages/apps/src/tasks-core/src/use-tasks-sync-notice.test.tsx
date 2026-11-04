import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flush = vi.fn();
vi.mock("@/lib/offline/tasks/tasks-offline-store", () => ({
  listFailedTaskOutbox: vi.fn(),
}));
vi.mock("@/lib/offline/tasks/tasks-hybrid-operations", () => ({
  getTasksSyncRunner: () => ({ flush }),
}));
vi.mock("@/lib/offline/tasks/tasks-bootstrap-sync", () => ({
  notifyTasksBootstrapUpdated: vi.fn(),
}));

import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { listFailedTaskOutbox } from "@/lib/offline/tasks/tasks-offline-store";
import { defaultTasksLabels as L } from "@/tasks-core/src/tasks-labels";
import { useTasksSyncNotice } from "@/tasks-core/src/use-tasks-sync-notice";

const failedRow = {
  id: "a",
  domain: "tasks",
  op: "upsert",
  payload: "{}",
  createdAt: 1,
  retries: 2,
  lastError: "boom",
};

describe("useTasksSyncNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flush.mockResolvedValue(undefined);
  });

  it("shows nothing while nothing failed", async () => {
    vi.mocked(listFailedTaskOutbox).mockResolvedValue([]);
    const reloadFromCache = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useTasksSyncNotice({ username: "member", labels: L, reloadFromCache }),
    );
    await waitFor(() => expect(listFailedTaskOutbox).toHaveBeenCalledWith("member"));
    expect(result.current).toBeNull();
  });

  it("shows the notice while rows failed, and Retry flushes, rereads and clears it", async () => {
    vi.mocked(listFailedTaskOutbox).mockResolvedValue([failedRow]);
    const reloadFromCache = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useTasksSyncNotice({ username: "member", labels: L, reloadFromCache }),
    );
    await waitFor(() => expect(result.current?.title).toBe(L.syncFailedNotice));
    expect(result.current?.actionLabel).toBe(L.retrySync);

    vi.mocked(listFailedTaskOutbox).mockResolvedValue([]);
    act(() => result.current!.onAction());
    await waitFor(() => expect(result.current).toBeNull());
    expect(flush).toHaveBeenCalledOnce();
    expect(reloadFromCache).toHaveBeenCalledOnce();
    expect(notifyTasksBootstrapUpdated).toHaveBeenCalledWith("member");
  });

  it("keeps the notice when the retry fails again", async () => {
    vi.mocked(listFailedTaskOutbox).mockResolvedValue([failedRow]);
    flush.mockRejectedValue(new Error("offline"));
    const reloadFromCache = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useTasksSyncNotice({ username: "member", labels: L, reloadFromCache }),
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.onAction());
    await waitFor(() => expect(result.current?.actionDisabled).toBe(false));
    expect(result.current?.title).toBe(L.syncFailedNotice);
  });
});
