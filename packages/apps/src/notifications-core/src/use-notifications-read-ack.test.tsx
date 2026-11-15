/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  NotificationInboxItem,
  NotificationInboxList,
} from "@/lib/models/notifications-types";
import {
  READ_ACK_BATCH_MAX,
  READ_ACK_RETRY_MS,
  READ_ACK_SETTLE_MS,
  type ReadAckDeps,
  useNotificationsReadAck,
} from "@/notifications-core/src/use-notifications-read-ack";

function row(id: string): NotificationInboxItem {
  return {
    id,
    domain: "chat",
    action: "mentioned",
    title: "t",
    body: null,
    navigate: "/meet/channels/general",
    tag: null,
    readAt: null,
    createdAt: "2026-11-14T01:00:00Z",
  };
}

function ids(count: number, prefix = "n"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

function inbox(rowIds: readonly string[]): NotificationInboxList {
  return { list: rowIds.map(row), unreadCount: rowIds.length };
}

describe("useNotificationsReadAck", () => {
  let send: ReturnType<typeof vi.fn<(ids: readonly string[]) => Promise<void>>>;
  let now: number;
  let warn: ReturnType<typeof vi.spyOn>;

  function mount() {
    const deps: ReadAckDeps = { send, now: () => now };
    return renderHook(() => useNotificationsReadAck(deps)).result;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    send = vi.fn(async () => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("marks 32 rows read with one request", async () => {
    const result = mount();

    await act(() => result.current.markRead(ids(32)));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(ids(32));
  });

  it("splits more rows than the server takes into batches", async () => {
    const result = mount();

    await act(() => result.current.markRead(ids(READ_ACK_BATCH_MAX + 5)));

    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([READ_ACK_BATCH_MAX, 5]);
  });

  it("does not send a row again while it waits for the server", async () => {
    let release: () => void = () => undefined;
    send.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const result = mount();

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.markRead(["n1", "n2"]);
    });
    // The channel stays open: the same rows are matched again, plus a new one.
    act(() => {
      void result.current.markRead(["n1", "n2", "n3"]);
    });
    await act(async () => {
      release();
      await first;
    });

    expect(send.mock.calls.map(([batch]) => [...batch])).toEqual([["n1", "n2"], ["n3"]]);
  });

  it("retries a failed ack with a backoff and keeps the rows hidden meanwhile", async () => {
    send.mockRejectedValueOnce(new WgwRequestError("POST /notifications/ack failed (503)", 503));
    const result = mount();

    await act(() => result.current.markRead(["n1", "n2"]));

    expect(warn).toHaveBeenCalledWith(
      "[notifications] mark as read failed; will retry",
      expect.any(WgwRequestError),
    );
    // A refresh meanwhile still lists them as unread: the tray keeps them out.
    expect(result.current.hideMarkedRead(inbox(["n1", "n2", "n9"]))).toEqual(inbox(["n9"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_ACK_RETRY_MS[0]!);
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(["n1", "n2"]);
  });

  it("schedules no retry once the provider unmounted mid-request", async () => {
    let fail: (error: Error) => void = () => undefined;
    send.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    const deps: ReadAckDeps = { send, now: () => now };
    const hook = renderHook(() => useNotificationsReadAck(deps));

    const pending = hook.result.current.markRead(["n1"]);
    hook.unmount();
    await act(async () => {
      fail(new WgwRequestError("POST /notifications/ack failed (503)", 503));
      await pending;
      await vi.advanceTimersByTimeAsync(READ_ACK_RETRY_MS.reduce((sum, ms) => sum + ms, 0));
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("after the backoff runs out, the next inbox refresh retries", async () => {
    send.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = mount();

    await act(() => result.current.markRead(["n1"]));
    for (const delay of READ_ACK_RETRY_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }
    const tries = send.mock.calls.length;
    expect(tries).toBe(READ_ACK_RETRY_MS.length + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(send).toHaveBeenCalledTimes(tries);

    send.mockResolvedValue(undefined);
    await act(async () => {
      result.current.retryUnconfirmed();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(send).toHaveBeenCalledTimes(tries + 1);
  });

  it("drops rows the server refuses for good instead of retrying them", async () => {
    send.mockRejectedValueOnce(new WgwRequestError("POST /notifications/ack failed (400)", 400));
    const result = mount();

    await act(() => result.current.markRead(["n1"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_ACK_RETRY_MS[0]! * 10);
      result.current.retryUnconfirmed();
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[notifications] mark as read refused",
      expect.any(WgwRequestError),
    );
    expect(result.current.hideMarkedRead(inbox(["n1"]))).toEqual(inbox(["n1"]));
  });

  it("hides a confirmed row from a list fetched before the ack landed, then lets go", async () => {
    const result = mount();

    await act(() => result.current.markRead(["n1"]));

    expect(result.current.hideMarkedRead(inbox(["n1", "n2"]))).toEqual(inbox(["n2"]));
    now += READ_ACK_SETTLE_MS + 1;
    expect(result.current.hideMarkedRead(inbox(["n1", "n2"]))).toEqual(inbox(["n1", "n2"]));
  });
});
