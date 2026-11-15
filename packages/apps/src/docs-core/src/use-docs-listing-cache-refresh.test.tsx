import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WgwUnifiedSearchData, WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { useDocsHomeList } from "@/docs-core/src/use-docs-home-list";
import { type DocsHomeFetcher } from "@/lib/files/docs-home-listing";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { applyDocsInboundChanges } from "@/lib/offline/docs/docs-inbound-sync";
import { writeDocsListingToCache } from "@/lib/offline/docs/docs-listing-offline-store";
import { keepLiveNodeIds } from "@/docs-core/src/use-docs-listing-cache-refresh";

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
  readBrowserOnline: vi.fn(() => true),
}));

vi.mock("@/hooks/use-connectivity", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOnReconnect: () => undefined,
}));

function doc(sourceKey: string, id: number, modifiedAt = 100): WgwUnifiedSearchResult {
  const title = sourceKey.split("/").pop() ?? sourceKey;
  return {
    id,
    sourceType: "file",
    sourceKey,
    title,
    extension: "md",
    category: "document",
    size: 1,
    modifiedAt,
  };
}

function fetcherFor(rows: WgwUnifiedSearchResult[]): DocsHomeFetcher {
  return vi.fn(async (params): Promise<WgwUnifiedSearchData> => ({
    query: "",
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    hasMore: false,
    sources: ["file"],
    filters: {},
    results: (params.offset ?? 0) === 0 ? rows : [],
  }));
}

describe("Docs home and inbound sync (#1563)", () => {
  it("shows a Doc deleted and one renamed elsewhere without a reload", async () => {
    const fetcher = fetcherFor([
      doc("users/ivy/a.md", 1, 300),
      doc("users/ivy/b.md", 2, 200),
      doc("users/ivy/c.md", 3, 100),
    ]);
    const { result: hook } = renderHook(() =>
      useDocsHomeList({ username: "ivy", fetcher, debounceMs: 0, offlineUsername: "ivy" }),
    );
    await waitFor(() => expect(hook.current.files).toHaveLength(3));
    const calls = vi.mocked(fetcher).mock.calls.length;

    await act(async () => {
      await applyDocsInboundChanges("ivy", [
        { kind: "removed", path: "/users/ivy/a.md" },
        {
          kind: "moved",
          from: "/users/ivy/b.md",
          to: "/users/ivy/b renamed.md",
          node: { directory: false, size: 1, modifiedAt: 200 },
        },
      ]);
    });

    await waitFor(() =>
      expect(hook.current.files.map((file) => file.title)).toEqual(["b renamed.md", "c.md"]),
    );
    expect(vi.mocked(fetcher).mock.calls.length).toBe(calls);
  });

  it("keeps a Doc created offline that the live listing does not have yet", async () => {
    await writeDocsListingToCache(
      "jay",
      {},
      { results: [doc("users/jay/offline.md", 0, 900)], hasMore: false },
    );
    await enqueueOutboxMutation("jay", {
      id: "create-1",
      domain: "docs",
      op: "create",
      payload: JSON.stringify({ op: "create", apiPath: "/users/jay/offline.md", content: "x" }),
    });
    const fetcher = fetcherFor([doc("users/jay/live.md", 1, 100)]);

    const { result: hook } = renderHook(() =>
      useDocsHomeList({ username: "jay", fetcher, debounceMs: 0, offlineUsername: "jay" }),
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await waitFor(() => expect(hook.current.refreshing).toBe(false));
    expect(hook.current.files.map((file) => file.title)).toEqual(["offline.md", "live.md"]);
  });

  it("keeps a live row's FileNode id when the list refreshes from the cache (#1976)", async () => {
    const nodeA = `fn-${"a".repeat(32)}`;
    const nodeC = `fn-${"c".repeat(32)}`;
    const fetcher = fetcherFor([
      { ...doc("users/kim/a.md", 1, 300), nodeId: nodeA },
      doc("users/kim/b.md", 2, 200),
      { ...doc("users/kim/c.md", 3, 100), nodeId: nodeC },
    ]);
    const { result: hook } = renderHook(() =>
      useDocsHomeList({ username: "kim", fetcher, debounceMs: 0, offlineUsername: "kim" }),
    );
    await waitFor(() => expect(hook.current.files).toHaveLength(3));
    await waitFor(() => expect(hook.current.refreshing).toBe(false));

    await act(async () => {
      await applyDocsInboundChanges("kim", [{ kind: "removed", path: "/users/kim/b.md" }]);
    });

    await waitFor(() => expect(hook.current.files).toHaveLength(2));
    expect(hook.current.files.map((file) => file.nodeId)).toEqual([nodeA, nodeC]);
  });
});

describe("keepLiveNodeIds", () => {
  const nodeId = `fn-${"d".repeat(32)}`;

  it("carries the id over for the same path and modified time", () => {
    const shown = [{ ...doc("users/lee/a.md", 1, 100), nodeId }];
    expect(keepLiveNodeIds(shown, [doc("users/lee/a.md", 1, 100)])[0]?.nodeId).toBe(nodeId);
  });

  it("drops the id when the cached file changed or moved", () => {
    const shown = [{ ...doc("users/lee/a.md", 1, 100), nodeId }];
    const cached = [doc("users/lee/a.md", 1, 200), doc("users/lee/b.md", 2, 100)];
    expect(keepLiveNodeIds(shown, cached).map((row) => row.nodeId)).toEqual([undefined, undefined]);
  });
});
