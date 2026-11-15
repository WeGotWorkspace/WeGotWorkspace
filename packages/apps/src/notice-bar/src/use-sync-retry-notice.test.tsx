import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";

const base = {
  id: "sync:notes",
  title: "Some changes could not sync. They are saved on this device.",
  retryLabel: "Retry",
};

describe("useSyncRetryNotice", () => {
  it("shows no row while nothing is stuck", () => {
    const { result } = renderHook(() =>
      useSyncRetryNotice({ ...base, active: false, onRetry: vi.fn() }),
    );
    expect(result.current).toBeNull();
  });

  it("shows an error row with Retry while changes are stuck", () => {
    const { result } = renderHook(() =>
      useSyncRetryNotice({ ...base, active: true, onRetry: vi.fn() }),
    );
    expect(result.current).toMatchObject({
      id: "sync:notes",
      tone: "error",
      title: base.title,
      actionLabel: "Retry",
      actionDisabled: false,
    });
  });

  it("disables Retry until the retry settles", async () => {
    let settle!: () => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useSyncRetryNotice({ ...base, active: true, onRetry }));

    await act(async () => {
      result.current?.onAction();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.current?.actionDisabled).toBe(true);

    await act(async () => {
      settle();
    });
    expect(result.current?.actionDisabled).toBe(false);
  });

  it("enables Retry again when the retry fails", async () => {
    const onRetry = vi.fn(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useSyncRetryNotice({ ...base, active: true, onRetry }));

    await act(async () => {
      result.current?.onAction();
    });
    expect(result.current?.actionDisabled).toBe(false);
  });
});
