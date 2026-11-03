/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsPendingWrites } from "@/lib/offline/docs/docs-inbound-plan";

const state = vi.hoisted(() => ({
  online: true,
  onReconnect: null as null | (() => void),
  onSettled: null as null | ((key: number) => void),
  owned: new Set<string>(),
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
  readDocsPendingWrites: async () => ({}) as DocsPendingWrites,
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

// The open Doc follows its file and holds its save while the path is unsure (#1563).
describe("useDocsEditorPathFollow", () => {
  beforeEach(() => {
    state.online = true;
    state.owned = new Set();
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

  it("holds the save after being offline until the next pull settles online", () => {
    state.online = false;
    const { result, rerender } = render("/users/alice/Plan.md");
    expect(result.current.holdServerSave).toBe(true);

    state.online = true;
    act(() => state.onReconnect?.());
    rerender();
    expect(result.current.holdServerSave).toBe(true);

    act(() => state.onSettled?.(1));
    expect(result.current.holdServerSave).toBe(false);
  });

  it("ignores a pull that settled for an older reconnect", () => {
    state.online = false;
    const { result } = render("/users/alice/Plan.md");
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

  it("holds nothing on the Docs home", () => {
    state.online = false;
    const { result } = render(null);
    expect(result.current.holdServerSave).toBe(false);
  });
});
