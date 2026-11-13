/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsPendingWrites } from "@/lib/offline/docs/docs-inbound-plan";

const state = vi.hoisted(() => ({
  online: true,
  onReconnect: null as null | (() => void),
  onSettled: null as null | ((key: number) => void),
  owned: new Set<string>(),
  readFails: false,
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: state.online }),
  useOnReconnect: (callback: () => void) => {
    state.onReconnect = callback;
  },
}));
vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => state.online,
}));
vi.mock("@/lib/offline/drive/use-drive-file-node-inbound", () => ({
  useDriveFileNodeInbound: (
    _username: string | undefined,
    _key: number,
    onSettled: (key: number) => void,
  ) => {
    state.onSettled = onSettled;
  },
}));
vi.mock("@/lib/offline/docs/docs-inbound-sync", () => ({
  readDocsPendingWrites: async () => {
    if (state.readFails) throw new Error("idb");
    return {} as DocsPendingWrites;
  },
  subscribeDocsCachesChanged: () => () => undefined,
}));
vi.mock("@/lib/offline/docs/docs-inbound-plan", () => ({
  docsSourceKey: (path: string) => path.replace(/^\/+/, ""),
  docsRowOwnedByQueuedWrite: (_pending: DocsPendingWrites, key: string) => state.owned.has(key),
}));

import { publishDocsPathMoved } from "@/lib/offline/docs/docs-path-moves";
import { useDocsEditorPathFollow } from "@/docs-core/src/use-docs-editor-path-follow";

function render(filePath: string | null, onFollow = vi.fn()) {
  return renderHook(() => useDocsEditorPathFollow({ username: "alice", filePath, onFollow }));
}

/** Let the queued-write read answer. */
async function settleQueueRead() {
  await act(async () => {});
}

// The open Doc follows its file and holds its save while the path is unsure (#1563).
describe("useDocsEditorPathFollow", () => {
  beforeEach(() => {
    state.online = true;
    state.owned = new Set();
    state.readFails = false;
  });

  it("opens the new path when the Doc, or its folder, moves", async () => {
    const onFollow = vi.fn();
    render("/users/alice/F/Plan.md", onFollow);

    act(() => publishDocsPathMoved("alice", "/users/alice/F", "/users/alice/G"));

    await waitFor(() => expect(onFollow).toHaveBeenCalledWith("/users/alice/G/Plan.md"));
  });

  it("ignores moves of other files", async () => {
    const onFollow = vi.fn();
    render("/users/alice/Plan.md", onFollow);
    act(() => publishDocsPathMoved("alice", "/users/alice/Other.md", "/users/alice/X.md"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onFollow).not.toHaveBeenCalled();
  });

  it("holds the save after being offline until the next pull settles online", async () => {
    state.online = false;
    const { result, rerender } = render("/users/alice/Plan.md");
    await settleQueueRead();
    expect(result.current.holdServerSave).toBe(true);

    state.online = true;
    act(() => state.onReconnect?.());
    rerender();
    expect(result.current.holdServerSave).toBe(true);

    act(() => state.onSettled?.(1));
    expect(result.current.holdServerSave).toBe(false);
  });

  it("keeps the hold after a followed move until the open path changes", async () => {
    state.online = false;
    let path = "/users/alice/Plan.md";
    const { result, rerender } = renderHook(() =>
      useDocsEditorPathFollow({ username: "alice", filePath: path, onFollow: vi.fn() }),
    );
    await settleQueueRead();
    state.online = true;
    act(() => state.onReconnect?.());
    act(() => publishDocsPathMoved("alice", "/users/alice/Plan.md", "/users/alice/New.md"));
    act(() => state.onSettled?.(1));
    expect(result.current.holdServerSave).toBe(true);

    path = "/users/alice/New.md";
    rerender();
    // The new path's queue read has not answered yet.
    expect(result.current.holdServerSave).toBe(true);
    await settleQueueRead();
    expect(result.current.holdServerSave).toBe(false);
  });

  it("ignores a pull that settled for an older reconnect", async () => {
    state.online = false;
    const { result } = render("/users/alice/Plan.md");
    await settleQueueRead();
    state.online = true;
    act(() => state.onReconnect?.());
    act(() => state.onReconnect?.());

    act(() => state.onSettled?.(1));
    expect(result.current.holdServerSave).toBe(true);
    act(() => state.onSettled?.(2));
    expect(result.current.holdServerSave).toBe(false);
  });

  it("holds the save while a queued create still owns the path", async () => {
    state.owned = new Set(["users/alice/New.md"]);
    const { result } = render("/users/alice/New.md");
    await waitFor(() => expect(result.current.holdServerSave).toBe(true));
  });

  it("holds the save on the first render, before the queue has answered", async () => {
    const { result } = render("/users/alice/Plan.md");
    expect(result.current.holdServerSave).toBe(true);
    await settleQueueRead();
    expect(result.current.holdServerSave).toBe(false);
  });

  // A hold that only waits for a check still expects the server text (#2056).
  it("tells a hold until the queue answers from one a queued create owns", async () => {
    const opened = render("/users/alice/Plan.md");
    expect(opened.result.current.holdUntilChecked).toBe(true);
    await settleQueueRead();
    expect(opened.result.current.holdUntilChecked).toBe(false);

    state.owned = new Set(["users/alice/New.md"]);
    const created = render("/users/alice/New.md");
    await waitFor(() => expect(created.result.current.holdUntilChecked).toBe(false));
    expect(created.result.current.holdServerSave).toBe(true);
  });

  it("keeps holding the save when the queue cannot be read", async () => {
    state.readFails = true;
    const { result } = render("/users/alice/Plan.md");
    await settleQueueRead();
    expect(result.current.holdServerSave).toBe(true);
  });

  it("knows on the first render of a followed path whether a queued write owns it", async () => {
    for (const owned of [false, true]) {
      state.owned = owned ? new Set(["users/alice/New.md"]) : new Set();
      let path = "/users/alice/Plan.md";
      const onFollow = vi.fn((next: string) => {
        path = next;
      });
      const { result, rerender } = renderHook(() =>
        useDocsEditorPathFollow({ username: "alice", filePath: path, onFollow }),
      );
      await settleQueueRead();

      act(() => publishDocsPathMoved("alice", "/users/alice/Plan.md", "/users/alice/New.md"));
      await waitFor(() => expect(onFollow).toHaveBeenCalledWith("/users/alice/New.md"));
      // The first render on the new path, before its own queue read has run.
      rerender();
      expect(result.current.holdServerSave).toBe(owned);
    }
  });

  it("holds nothing on the Docs home", () => {
    state.online = false;
    const { result } = render(null);
    expect(result.current.holdServerSave).toBe(false);
  });
});
