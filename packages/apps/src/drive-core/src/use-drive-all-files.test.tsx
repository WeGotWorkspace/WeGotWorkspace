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

describe("withDriveRootLocation", () => {
  it("keeps Personal rows and unknown team drives as they are", () => {
    const file = { parent: "Groups/ops/sub", location: "ops" } as never;
    expect(withDriveRootLocation(file, {})).toBe(file);
  });
});
