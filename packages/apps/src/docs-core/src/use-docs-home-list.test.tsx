import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwUnifiedSearchData, WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import {
  fetchAllDocsHomeListingPages,
  mapDocsHomeResults,
  sortDocsHomeResults,
  useDocsHomeList,
  type DocsHomeFetcher,
} from "@/docs-core/src/use-docs-home-list";
import { writeDocsListingToCache } from "@/lib/offline/docs-listing-offline-store";

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
  readBrowserOnline: vi.fn(() => true),
}));

vi.mock("@/hooks/use-connectivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-connectivity")>();
  return {
    ...actual,
    useOnReconnect: () => undefined,
  };
});

import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";

function result(
  id: number,
  sourceKey: string,
  title: string,
  modifiedAt: number,
): WgwUnifiedSearchResult {
  return {
    id,
    sourceType: "file",
    sourceKey,
    title,
    extension: sourceKey.split(".").pop() ?? "md",
    category: "document",
    size: 100,
    modifiedAt,
  };
}

const FIXTURES = [
  result(1, "users/alice/A.md", "A", 500),
  result(2, "groups/eng/B.md", "B", 400),
  result(3, "users/alice/C.txt", "C", 300),
  result(4, "groups/design/D.md", "D", 200),
  result(5, "users/alice/E.md", "E", 100),
];

function createFetcher(all: WgwUnifiedSearchResult[], pageSize = 2): DocsHomeFetcher {
  return vi.fn(async (params): Promise<WgwUnifiedSearchData> => {
    const q = (params.q ?? "").trim().toLowerCase();
    const filtered = q ? all.filter((item) => item.title.toLowerCase().includes(q)) : all;
    const start = params.offset ?? 0;
    const results = filtered.slice(start, start + pageSize);
    return {
      query: params.q ?? "",
      limit: params.limit ?? pageSize,
      offset: start,
      hasMore: start + results.length < filtered.length,
      sources: params.sources ?? ["file"],
      filters: {},
      results,
    };
  });
}

describe("sortDocsHomeResults", () => {
  it("orders newest first, tie-breaking on id descending", () => {
    const unsorted = [
      result(10, "users/alice/x.md", "X", 100),
      result(11, "users/alice/y.md", "Y", 300),
      result(12, "users/alice/z.md", "Z", 300),
    ];
    expect(sortDocsHomeResults(unsorted).map((item) => item.id)).toEqual([12, 11, 10]);
  });
});

describe("mapDocsHomeResults", () => {
  it("maps to drive files, sorts modified-desc, and derives the location label", () => {
    const files = mapDocsHomeResults([FIXTURES[2], FIXTURES[0], FIXTURES[1]], "alice", {
      groupRoots: [{ slug: "eng", label: "Engineering" }],
    });
    expect(files.map((f) => f.title)).toEqual(["A", "B", "C"]);
    expect(files[0]).toMatchObject({
      title: "A",
      location: "Personal",
      kind: "doc",
      apiPath: "/users/alice/A.md",
    });
    expect(files[1].location).toBe("Engineering");
  });

  it("falls back to group slug when no display label is known", () => {
    const files = mapDocsHomeResults([FIXTURES[1]], "alice");
    expect(files[0].location).toBe("eng");
  });

  it("maps administrators slug to principal display name when groupRoots provided", () => {
    const files = mapDocsHomeResults(
      [result(20, "groups/administrators/notes.md", "Notes", 600)],
      "alice",
      { groupRoots: [{ slug: "administrators", label: "Administrators" }] },
    );
    expect(files[0].location).toBe("Administrators");
  });

  it("dedupes repeated source keys", () => {
    const dup = result(9, "users/alice/A.md", "A copy", 999);
    const files = mapDocsHomeResults([FIXTURES[0], dup], "alice");
    expect(files).toHaveLength(1);
    expect(files[0].title).toBe("A copy");
  });

  it("formats byte sizes for list and grid display", () => {
    const large = { ...result(1, "users/alice/big.md", "Big", 500), size: 1_048_576 };
    const files = mapDocsHomeResults([large], "alice");
    expect(files[0].size).toBe("1.0 MB");
  });
});

describe("fetchAllDocsHomeListingPages", () => {
  it("walks offset pagination until hasMore is false", async () => {
    const fetcher = createFetcher(FIXTURES, 2);
    const controller = new AbortController();
    const data = await fetchAllDocsHomeListingPages(
      fetcher,
      { sources: ["file"], extensions: ["md"], categories: ["document"], limit: 2 },
      "",
      controller.signal,
    );
    expect(data.results.map((row) => row.title)).toEqual(["A", "B", "C", "D", "E"]);
    expect(data.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("useDocsHomeList", () => {
  beforeEach(() => {
    vi.mocked(getConnectivitySnapshot).mockReturnValue(true);
  });

  it("loads the full browse listing across paginated API pages", async () => {
    const fetcher = createFetcher(FIXTURES, 2);
    const { result: hook } = renderHook(() =>
      useDocsHomeList({ username: "alice", fetcher, debounceMs: 0 }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.files.map((f) => f.title)).toEqual(["A", "B", "C", "D", "E"]);
    expect(hook.current.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("restores cached hasMore when serving an offline listing", async () => {
    vi.mocked(getConnectivitySnapshot).mockReturnValue(false);
    await writeDocsListingToCache(
      "alice",
      { query: "" },
      {
        results: FIXTURES.slice(0, 2),
        hasMore: true,
      },
    );

    const fetcher = vi.fn(createFetcher(FIXTURES, 2));
    const { result: hook } = renderHook(() =>
      useDocsHomeList({
        username: "alice",
        fetcher,
        debounceMs: 0,
        offlineUsername: "alice",
      }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.current.files.map((f) => f.title)).toEqual(["A", "B"]);
    expect(hook.current.hasMore).toBe(true);
    expect(hook.current.isOfflineListing).toBe(true);
  });

  it("re-sorts appended pages modified-desc as a safety net", async () => {
    const outOfOrder = [
      result(1, "users/alice/old.md", "Old", 100),
      result(2, "users/alice/new.md", "New", 900),
    ];
    const fetcher = createFetcher(outOfOrder, 1);
    const { result: hook } = renderHook(() =>
      useDocsHomeList({ username: "alice", fetcher, debounceMs: 0 }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.files.map((f) => f.title)).toEqual(["New", "Old"]);
  });

  it("debounces the query and resets pagination", async () => {
    const fetcher = createFetcher(FIXTURES, 2);
    const { result: hook, rerender } = renderHook(
      ({ q }) => useDocsHomeList({ username: "alice", query: q, fetcher, debounceMs: 0 }),
      { initialProps: { q: "" } },
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.files).toHaveLength(5);

    rerender({ q: "d" });
    await waitFor(() => expect(hook.current.files.map((f) => f.title)).toEqual(["D"]));
    expect(hook.current.hasMore).toBe(false);
  });

  it("forwards pathPrefix to the fetcher and reloads when the scope changes", async () => {
    const scopedFetcher = createScopedFetcher(FIXTURES, 50);
    const { result: hook, rerender } = renderHook(
      ({ prefix }: { prefix?: string }) =>
        useDocsHomeList({
          username: "alice",
          pathPrefix: prefix,
          fetcher: scopedFetcher,
          debounceMs: 0,
        }),
      { initialProps: { prefix: undefined as string | undefined } },
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.files.map((f) => f.title)).toEqual(["A", "B", "C", "D", "E"]);

    rerender({ prefix: "groups/eng" });
    await waitFor(() => expect(hook.current.files.map((f) => f.title)).toEqual(["B"]));

    rerender({ prefix: "users/alice" });
    await waitFor(() => expect(hook.current.files.map((f) => f.title)).toEqual(["A", "C", "E"]));
  });

  it("falls back to cached listing when offline", async () => {
    vi.mocked(getConnectivitySnapshot).mockReturnValue(false);
    await writeDocsListingToCache(
      "alice",
      { query: "" },
      {
        results: FIXTURES.slice(0, 2),
        hasMore: false,
      },
    );

    const fetcher = vi.fn(createFetcher(FIXTURES, 2));
    const { result: hook } = renderHook(() =>
      useDocsHomeList({
        username: "alice",
        fetcher,
        debounceMs: 0,
        offlineUsername: "alice",
      }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.current.files.map((f) => f.title)).toEqual(["A", "B"]);
    expect(hook.current.isOfflineListing).toBe(true);
  });
});

function createScopedFetcher(all: WgwUnifiedSearchResult[], pageSize: number): DocsHomeFetcher {
  return vi.fn(async (params): Promise<WgwUnifiedSearchData> => {
    const prefix = params.pathPrefix?.trim() ?? "";
    const filtered = prefix ? all.filter((item) => item.sourceKey.startsWith(`${prefix}/`)) : all;
    const start = params.offset ?? 0;
    const results = filtered.slice(start, start + pageSize);
    return {
      query: params.q ?? "",
      limit: params.limit ?? pageSize,
      offset: start,
      hasMore: start + results.length < filtered.length,
      sources: params.sources ?? ["file"],
      filters: { path_prefix: prefix || null },
      results,
    };
  });
}
