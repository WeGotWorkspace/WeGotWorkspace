/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JmapInboundAdapter } from "@/lib/jmap-client/adapter/JmapInboundAdapter";

vi.mock("./jmap-push", () => ({
  documentVisibility: () => ({ visible: () => true, subscribe: () => () => undefined }),
  randomTabId: () => "tab-1",
}));

import {
  inboundSyncShare,
  type InboundSyncMessage,
} from "@/lib/jmap-client/adapter/inbound-sync-share";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";
import {
  browserInboundSyncShare,
  useInboundSyncSeat,
  useSharedInboundSync,
} from "./use-shared-inbound-sync";

function fakeAdapter() {
  const stop = vi.fn();
  const shareAcrossTabs = vi.fn((_share: unknown, _onSharedRound: () => void) => stop);
  return { adapter: { shareAcrossTabs } as unknown as JmapInboundAdapter, shareAcrossTabs, stop };
}

function stubWebLocks(): void {
  vi.stubGlobal("navigator", {
    locks: { request: vi.fn(async () => undefined), query: vi.fn(async () => ({})) },
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      postMessage() {}
    },
  );
}

describe("useSharedInboundSync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("without Web Locks every tab keeps syncing for itself", () => {
    vi.stubGlobal("navigator", {});
    const { adapter, shareAcrossTabs } = fakeAdapter();

    renderHook(() => useSharedInboundSync(adapter, "notes", "alice", () => undefined));

    expect(browserInboundSyncShare("notes", "alice")).toBeNull();
    expect(shareAcrossTabs).not.toHaveBeenCalled();
  });

  it("without BroadcastChannel every tab keeps syncing for itself", () => {
    stubWebLocks();
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(browserInboundSyncShare("notes", "alice")).toBeNull();
  });

  it("shares the adapter's sync once it is ready and stops on unmount", () => {
    stubWebLocks();
    const { adapter, shareAcrossTabs, stop } = fakeAdapter();
    const repaint = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ ready }) => useSharedInboundSync(ready, "notes", "alice", repaint),
      { initialProps: { ready: null as JmapInboundAdapter | null } },
    );
    expect(shareAcrossTabs).not.toHaveBeenCalled();

    rerender({ ready: adapter });
    expect(shareAcrossTabs).toHaveBeenCalledTimes(1);
    shareAcrossTabs.mock.calls[0][1]();
    expect(repaint).toHaveBeenCalledTimes(1);

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not share without an account", () => {
    stubWebLocks();
    const { adapter, shareAcrossTabs } = fakeAdapter();
    renderHook(() => useSharedInboundSync(adapter, "notes", null, () => undefined));
    expect(shareAcrossTabs).not.toHaveBeenCalled();
  });
});

describe("useInboundSyncSeat", () => {
  afterEach(() => vi.unstubAllGlobals());

  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /** One browser: this tab's `navigator.locks`, and another tab's seat for the same app. */
  function browserWithOtherTab() {
    const locks = new FakeWebLocks();
    vi.stubGlobal("navigator", { locks: locks.client("tab-1") });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        addEventListener() {}
        postMessage() {}
      },
    );
    const other = inboundSyncShare({
      name: "wgw-inbound-sync/tasks/alice",
      tabId: "other",
      locks: locks.client("other"),
      topic: new FakeCrossTabBus<InboundSyncMessage>().topic(),
      visibility: { visible: () => true, subscribe: () => () => undefined },
    });
    return { locks, other };
  }
  const noHandlers = { onOwn: () => undefined, onLose: () => undefined, onRound: () => undefined };

  it("owns the sync without Web Locks", () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useInboundSyncSeat("tasks", "alice", () => undefined));
    expect(result.current()).toBe(true);
  });

  it("owns the sync as the first tab, without a catch-up pull", async () => {
    browserWithOtherTab();
    const onTakeOver = vi.fn();
    const { result } = renderHook(() => useInboundSyncSeat("tasks", "alice", onTakeOver));
    expect(result.current()).toBe(false);
    await settle();
    expect(result.current()).toBe(true);
    expect(onTakeOver).not.toHaveBeenCalled();
  });

  it("waits behind the syncing tab and takes over when it closes", async () => {
    const { other } = browserWithOtherTab();
    const closeOther = other.start(noHandlers);
    await settle();
    const onTakeOver = vi.fn();
    const { result } = renderHook(() => useInboundSyncSeat("tasks", "alice", onTakeOver));
    await settle();
    expect(result.current()).toBe(false);

    closeOther();
    await settle();
    expect(result.current()).toBe(true);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it("leaves its seat on unmount, so the next tab syncs", async () => {
    const { locks, other } = browserWithOtherTab();
    const { unmount } = renderHook(() => useInboundSyncSeat("tasks", "alice", () => undefined));
    await settle();
    expect(locks.holder("wgw-inbound-sync/tasks/alice")).toBe("tab-1");
    const onOwn = vi.fn();
    other.start({ ...noHandlers, onOwn });
    await settle();
    expect(onOwn).not.toHaveBeenCalled();

    unmount();
    await settle();
    expect(onOwn).toHaveBeenCalledWith(true);
  });
});
