/** @vitest-environment jsdom */
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useOfflineBodySyncRunning,
  type OfflineBodySyncProgress,
} from "@/lib/offline/core/use-offline-body-sync-running";

describe("useOfflineBodySyncRunning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-render the page while only the sync counts change", async () => {
    let synced = 0;
    const readProgress = vi.fn(async (): Promise<OfflineBodySyncProgress> => ({
      running: true,
      total: 1000,
      synced: ++synced,
      failed: 0,
      updatedAt: synced,
    }));
    let pageRenders = 0;
    function Page() {
      pageRenders += 1;
      return null;
    }
    function Host() {
      const running = useOfflineBodySyncRunning({ enabled: true, readProgress, pollMs: 100 });
      return running ? <Page /> : null;
    }
    render(<Host />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const rendersWhenRunning = pageRenders;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(readProgress.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(pageRenders).toBe(rendersWhenRunning);
  });

  it("reports when the sync stops", async () => {
    const states = [true, true, false];
    let read = 0;
    const readProgress = vi.fn(async (): Promise<OfflineBodySyncProgress> => ({
      running: states[Math.min(read++, states.length - 1)]!,
      total: 2,
      synced: read,
      failed: 0,
      updatedAt: read,
    }));
    const { result } = renderHook(() =>
      useOfflineBodySyncRunning({ enabled: true, readProgress, pollMs: 100 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toBe(false);
  });

  it("stays false when disabled", async () => {
    const readProgress = vi.fn();
    const { result } = renderHook(() =>
      useOfflineBodySyncRunning({ enabled: false, readProgress, pollMs: 100 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current).toBe(false);
    expect(readProgress).not.toHaveBeenCalled();
  });
});
