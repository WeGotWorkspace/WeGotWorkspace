import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const steps: string[] = [];
const flush = vi.fn(async () => {
  steps.push("flush");
});
vi.mock("@/lib/offline/meet-chat/meet-chat-offline-store", () => ({
  listFailedMeetChatOutbox: vi.fn(),
}));
vi.mock("@/lib/offline/meet-chat/meet-chat-hybrid-operations", () => ({
  getMeetChatSyncRunner: () => ({ flush }),
}));

import { listFailedMeetChatOutbox } from "@/lib/offline/meet-chat/meet-chat-offline-store";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { useMeetChatSyncNotice } from "@/meet-core/src/use-meet-chat-sync-notice";

const refusedSend = {
  id: "send-1",
  domain: "meet-chat",
  op: "send",
  payload: "{}",
  createdAt: 1,
  retries: 1,
  lastError: "This channel is read-only",
  lastStatus: 403,
};

describe("useMeetChatSyncNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    steps.length = 0;
  });

  it("stays hidden until a chat write fails", async () => {
    vi.mocked(listFailedMeetChatOutbox).mockResolvedValue([]);
    const patchFromCache = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMeetChatSyncNotice({ username: "ada", patchFromCache }));
    await waitFor(() => expect(listFailedMeetChatOutbox).toHaveBeenCalledWith("ada"));
    expect(result.current).toBeNull();
  });

  it("offers Retry for a failed write: flush, reread the cache, recount", async () => {
    vi.mocked(listFailedMeetChatOutbox).mockResolvedValue([refusedSend]);
    const patchFromCache = vi.fn(async () => {
      steps.push("patch");
    });
    const { result } = renderHook(() => useMeetChatSyncNotice({ username: "ada", patchFromCache }));
    await waitFor(() => expect(result.current?.id).toBe("sync:meet-chat"));
    expect(result.current?.title).toBe(meetLabels.syncFailedNotice);
    expect(result.current?.actionLabel).toBe(meetLabels.retrySync);

    vi.mocked(listFailedMeetChatOutbox).mockImplementation(async () => {
      steps.push("count");
      return [];
    });
    act(() => result.current!.onAction());
    await waitFor(() => expect(result.current).toBeNull());
    expect(steps.slice(0, 3)).toEqual(["flush", "patch", "count"]);
  });
});
