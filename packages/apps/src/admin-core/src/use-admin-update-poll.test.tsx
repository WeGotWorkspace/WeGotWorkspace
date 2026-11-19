import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import type { AdminUpdateProgress, AdminUpdateState } from "@/lib/models/admin-types";
import {
  UPDATE_IDLE_POLL_MS,
  UPDATE_PROGRESS_POLL_MS,
  useAdminUpdatePoll,
} from "@/admin-core/src/use-admin-update-poll";

const idle: AdminUpdateProgress = {
  inProgress: false,
  phase: null,
  current: null,
  download: null,
  phaseProgress: null,
  cancelRequested: false,
  cancelAllowed: false,
};

const running: AdminUpdateProgress = {
  ...idle,
  inProgress: true,
  phase: "extracting",
  current: { from: "1.0.0", to: "1.1.0", at: "2026-11-18T10:00:00Z" },
  phaseProgress: { completed: 5, total: 10, percent: 50, updatedAt: "2026-11-18T10:00:01Z" },
  cancelAllowed: true,
};

let hidden = false;

function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderPoll(
  initial: AdminUpdateState,
  operations: {
    refreshUpdateProgress: () => Promise<AdminUpdateProgress>;
    refreshUpdateState: () => Promise<AdminUpdateState>;
  },
) {
  return renderHook(() => {
    const [updates, setUpdates] = useState(initial);
    const applyRequestPendingRef = useRef(false);
    useAdminUpdatePoll({
      operations,
      inProgress: updates.inProgress,
      setUpdates,
      applyRequestPendingRef,
    });
    return updates;
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useAdminUpdatePoll", () => {
  let baseUpdates: AdminUpdateState;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    baseUpdates = createAdminAppBootstrap().data.updates;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls at most once a minute when no update runs, and never the full state", async () => {
    const refreshUpdateProgress = vi.fn(async () => idle);
    const refreshUpdateState = vi.fn(async () => baseUpdates);
    renderPoll({ ...baseUpdates, ...idle }, { refreshUpdateProgress, refreshUpdateState });

    await advance(UPDATE_IDLE_POLL_MS - 1);
    expect(refreshUpdateProgress).not.toHaveBeenCalled();

    await advance(1);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(1);

    await advance(4 * UPDATE_IDLE_POLL_MS);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(5);
    expect(refreshUpdateState).not.toHaveBeenCalled();
  });

  it("sends nothing while the tab is hidden and resumes on the old cadence when shown", async () => {
    const refreshUpdateProgress = vi.fn(async () => idle);
    const refreshUpdateState = vi.fn(async () => baseUpdates);
    renderPoll({ ...baseUpdates, ...idle }, { refreshUpdateProgress, refreshUpdateState });

    act(() => setHidden(true));
    await advance(30 * UPDATE_IDLE_POLL_MS);
    expect(refreshUpdateProgress).not.toHaveBeenCalled();

    // Shown again long after the last poll: one poll right away, then once a minute.
    act(() => setHidden(false));
    await advance(0);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(1);
    await advance(UPDATE_IDLE_POLL_MS);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(2);
  });

  it("does not poll extra when a tab is quickly hidden and shown again", async () => {
    const refreshUpdateProgress = vi.fn(async () => idle);
    renderPoll(
      { ...baseUpdates, ...idle },
      { refreshUpdateProgress, refreshUpdateState: vi.fn(async () => baseUpdates) },
    );

    for (let i = 0; i < 5; i += 1) {
      act(() => setHidden(true));
      await advance(1_000);
      act(() => setHidden(false));
      await advance(1_000);
    }
    expect(refreshUpdateProgress).not.toHaveBeenCalled();
  });

  it("does not poll while hidden during an update either", async () => {
    const refreshUpdateProgress = vi.fn(async () => running);
    renderPoll(
      { ...baseUpdates, ...running },
      { refreshUpdateProgress, refreshUpdateState: vi.fn(async () => baseUpdates) },
    );
    await advance(0);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(1);

    act(() => setHidden(true));
    await advance(60_000);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(1);
  });

  it("refreshes progress every two seconds during an update", async () => {
    const refreshUpdateProgress = vi.fn(async () => running);
    const refreshUpdateState = vi.fn(async () => baseUpdates);
    const { result } = renderPoll(
      { ...baseUpdates, ...running, phaseProgress: null },
      { refreshUpdateProgress, refreshUpdateState },
    );

    await advance(0);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(1);
    await advance(5 * UPDATE_PROGRESS_POLL_MS);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(6);
    expect(refreshUpdateState).not.toHaveBeenCalled();
    expect(result.current.phaseProgress?.percent).toBe(50);
    // The heavy fields stay as loaded.
    expect(result.current.backups).toEqual(baseUpdates.backups);
  });

  it("loads the full state once when the run ends, then slows down", async () => {
    let progress = running;
    const refreshUpdateProgress = vi.fn(async () => progress);
    const finished: AdminUpdateState = { ...baseUpdates, ...idle, installedVersion: "1.1.0" };
    const refreshUpdateState = vi.fn(async () => finished);
    const { result } = renderPoll(
      { ...baseUpdates, ...running },
      { refreshUpdateProgress, refreshUpdateState },
    );

    await advance(0);
    progress = idle;
    await advance(UPDATE_PROGRESS_POLL_MS);
    expect(refreshUpdateState).toHaveBeenCalledTimes(1);
    expect(result.current.inProgress).toBe(false);
    expect(result.current.installedVersion).toBe("1.1.0");

    const callsAtEnd = refreshUpdateProgress.mock.calls.length;
    await advance(UPDATE_IDLE_POLL_MS - 1);
    expect(refreshUpdateProgress).toHaveBeenCalledTimes(callsAtEnd);
    expect(refreshUpdateState).toHaveBeenCalledTimes(1);
  });

  it("switches to the fast poll when an update starts elsewhere", async () => {
    let progress = idle;
    const refreshUpdateProgress = vi.fn(async () => progress);
    const { result } = renderPoll(
      { ...baseUpdates, ...idle },
      { refreshUpdateProgress, refreshUpdateState: vi.fn(async () => baseUpdates) },
    );

    progress = running;
    await advance(UPDATE_IDLE_POLL_MS);
    expect(result.current.inProgress).toBe(true);
    const calls = refreshUpdateProgress.mock.calls.length;
    await advance(UPDATE_PROGRESS_POLL_MS * 2);
    expect(refreshUpdateProgress.mock.calls.length).toBeGreaterThanOrEqual(calls + 2);
  });
});
