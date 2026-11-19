/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JmapInboundAdapter } from "@/lib/jmap-client/adapter/JmapInboundAdapter";

vi.mock("./jmap-push", () => ({
  documentVisibility: () => ({ visible: () => true, subscribe: () => () => undefined }),
  randomTabId: () => "tab-1",
}));

import { browserInboundSyncShare, useSharedInboundSync } from "./use-shared-inbound-sync";

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
