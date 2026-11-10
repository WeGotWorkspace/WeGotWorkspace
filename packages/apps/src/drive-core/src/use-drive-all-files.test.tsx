import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { useDriveAllFiles, withDriveRootLocation } from "@/drive-core/src/use-drive-all-files";

function entry(path: string): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? path;
  return { name, path, type: "file", size: 10, time: 1_700_000_000 } as WgwDriveDirectoryEntry;
}

describe("useDriveAllFiles", () => {
  it("loads All Files page by page, with team drives under their display name", async () => {
    const listAllFiles = vi
      .fn<NonNullable<DriveAPIOperations["listAllFiles"]>>()
      .mockResolvedValueOnce({
        entries: [entry("/users/demo/a.md"), entry("/groups/team/b.md")],
        nextOffset: 3,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [entry("/users/demo/c.md")],
        nextOffset: 4,
        hasMore: false,
      });
    const operations = { listAllFiles } as unknown as DriveAPIOperations;

    const { result } = renderHook(() =>
      useDriveAllFiles({
        operations,
        view: { type: "all" },
        currentUsername: "demo",
        rootLabels: { "Groups/team": "Team" },
        showError: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.allItems?.length).toBe(2));
    expect(result.current.allItems?.map((file) => file.location)).toEqual(["Personal", "Team"]);
    expect(result.current.allHasMore).toBe(true);

    act(() => result.current.loadMoreAll());
    await waitFor(() => expect(result.current.allItems?.length).toBe(3));
    expect(listAllFiles).toHaveBeenLastCalledWith({ offset: 3, limit: 100 }, expect.anything());
    expect(result.current.allHasMore).toBe(false);
  });

  it("stays idle outside All Files", () => {
    const listAllFiles = vi.fn();
    const { result } = renderHook(() =>
      useDriveAllFiles({
        operations: { listAllFiles } as unknown as DriveAPIOperations,
        view: { type: "recent" },
        currentUsername: "demo",
        rootLabels: {},
        showError: vi.fn(),
      }),
    );
    expect(result.current.allItems).toBeNull();
    expect(listAllFiles).not.toHaveBeenCalled();
  });
});

type ListAllFiles = NonNullable<DriveAPIOperations["listAllFiles"]>;

function renderAllFiles(listAllFiles: ListAllFiles) {
  return renderHook(() =>
    useDriveAllFiles({
      operations: { listAllFiles } as unknown as DriveAPIOperations,
      view: { type: "all" },
      currentUsername: "demo",
      rootLabels: {},
      showError: vi.fn(),
    }),
  );
}

describe("useDriveAllFiles paging", () => {
  it("reads past a page of folders only instead of showing an empty list", async () => {
    const listAllFiles = vi
      .fn<ListAllFiles>()
      .mockResolvedValueOnce({ entries: [], nextOffset: 100, hasMore: true })
      .mockResolvedValueOnce({
        entries: [entry("/users/demo/c.md")],
        nextOffset: 150,
        hasMore: false,
      });

    const { result } = renderAllFiles(listAllFiles);

    await waitFor(() => expect(result.current.allLoading).toBe(false));
    expect(result.current.allItems?.map((file) => file.title)).toEqual(["c.md"]);
    expect(listAllFiles).toHaveBeenLastCalledWith({ offset: 100, limit: 100 }, expect.anything());
    expect(result.current.allHasMore).toBe(false);
  });

  it("keeps hasMore past the empty-page cap so a later file still loads", async () => {
    const listAllFiles = vi.fn<ListAllFiles>().mockImplementation(async ({ offset }) => {
      if (offset >= 1200) {
        return { entries: [entry("/users/demo/late.md")], nextOffset: 1300, hasMore: false };
      }
      return { entries: [], nextOffset: (offset ?? 0) + 100, hasMore: true };
    });

    const { result } = renderAllFiles(listAllFiles);

    await waitFor(() => expect(result.current.allLoading).toBe(false));
    expect(result.current.allItems).toEqual([]);
    expect(listAllFiles).toHaveBeenCalledTimes(10);
    expect(result.current.allHasMore).toBe(true);

    act(() => result.current.loadMoreAll());
    await waitFor(() => expect(result.current.allItems?.map((f) => f.title)).toEqual(["late.md"]));
    expect(result.current.allHasMore).toBe(false);
  });

  it("stops when the index does not move on", async () => {
    const listAllFiles = vi
      .fn<ListAllFiles>()
      .mockResolvedValue({ entries: [], nextOffset: 0, hasMore: true });

    const { result } = renderAllFiles(listAllFiles);

    await waitFor(() => expect(result.current.allLoading).toBe(false));
    expect(result.current.allItems).toEqual([]);
    expect(listAllFiles).toHaveBeenCalledTimes(2);
    expect(result.current.allHasMore).toBe(false);
  });

  it("does not add an old listing's next page to a reloaded first page", async () => {
    let resolveReload: (page: Awaited<ReturnType<ListAllFiles>>) => void = () => undefined;
    const listAllFiles = vi
      .fn<ListAllFiles>()
      .mockResolvedValueOnce({
        entries: [entry("/users/demo/a.md")],
        nextOffset: 100,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [entry("/users/demo/b.md")],
        nextOffset: 200,
        hasMore: true,
      })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveReload = resolve)))
      .mockResolvedValue({ entries: [entry("/users/demo/z.md")], nextOffset: 300, hasMore: false });

    const { result } = renderAllFiles(listAllFiles);
    await waitFor(() => expect(result.current.allItems?.length).toBe(1));
    act(() => result.current.loadMoreAll());
    await waitFor(() => expect(result.current.allItems?.length).toBe(2));

    act(() => result.current.reloadAllFiles());
    act(() => result.current.loadMoreAll());
    await act(async () => {
      resolveReload({ entries: [entry("/users/demo/new.md")], nextOffset: 100, hasMore: true });
    });

    await waitFor(() => expect(result.current.allItems?.map((f) => f.title)).toEqual(["new.md"]));
    expect(listAllFiles).not.toHaveBeenCalledWith({ offset: 200, limit: 100 }, expect.anything());
    expect(result.current.allHasMore).toBe(true);
  });
});

describe("withDriveRootLocation", () => {
  it("keeps Personal rows and unknown team drives as they are", () => {
    const file = { parent: "Groups/ops/sub", location: "ops" } as never;
    expect(withDriveRootLocation(file, {})).toBe(file);
  });
});
