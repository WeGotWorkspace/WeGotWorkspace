import { act, renderHook, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveFile } from "@/lib/files/drive-models";
import { useDriveMutations } from "./use-drive-mutations";
import { buildList, buildShell } from "./use-drive-mutations-fixtures";
import type { DriveShellState } from "./use-drive-shell";

describe("useDriveMutations: New folder", () => {
  it("a folder the server did not create leaves no row behind", async () => {
    const base = buildShell();
    let rows: DriveFile[] = base.files;
    const setFiles = vi.fn((update: DriveFile[] | ((previous: DriveFile[]) => DriveFile[])) => {
      rows = typeof update === "function" ? update(rows) : update;
    });
    const createFolder = vi.fn().mockRejectedValue(new Error("Server error"));
    const shell = buildShell({
      setFiles: setFiles as DriveShellState["setFiles"],
      operations: { ...base.operations, createFolder } as DriveShellState["operations"],
    });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));

    act(() => result.current.submitCreateFolder("Plans", "My Drive"));
    expect(rows.map((row) => row.title)).toContain("Plans");

    await waitFor(() => expect(createFolder).toHaveBeenCalled());
    await waitFor(() => expect(rows.map((row) => row.title)).not.toContain("Plans"));
    expect(rows.map((row) => row.title)).toEqual(["test.txt"]);
  });

  it("on a local tree a new folder goes into the open folder's tree rows, and the view stays", async () => {
    const base = buildShell();
    const commitView = vi.fn();
    const rootListing = {
      user: base.data.user,
      cwd: "/users/testuser",
      directory: { location: "/users/testuser", files: [] },
    };
    const createFolder = vi.fn().mockResolvedValue(rootListing);
    const shell = buildShell({
      view: { type: "folder", path: "My Drive/Projects" },
      groupRootNames: new Set<string>(),
      commitView,
      operations: {
        ...base.operations,
        localTree: true,
        createFolder,
      } as DriveShellState["operations"],
    });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));

    act(() => result.current.submitCreateFolder("Plans", "My Drive/Projects"));
    await waitFor(() => expect(createFolder).toHaveBeenCalled());

    const db = offlineDbForAccount(offlineAccountKeyFromUsername("testuser"));
    await waitFor(async () =>
      expect(
        (await driveEntriesTable(db).toArray()).map((row) => [row.id, row.parentPath]),
      ).toContainEqual(["users/testuser/Projects/Plans", "users/testuser/Projects"]),
    );
    expect(commitView).not.toHaveBeenCalledWith({ type: "folder", path: "My Drive" });
  });

  it("on a local tree a rename leaves the open folder as it is", async () => {
    const base = buildShell();
    const commitView = vi.fn();
    const rootListing = {
      user: base.data.user,
      cwd: "/users/testuser",
      directory: { location: "/users/testuser", files: [] },
    };
    const renameItem = vi.fn().mockResolvedValue(rootListing);
    const setFiles = vi.fn();
    const shell = buildShell({
      view: { type: "folder", path: "My Drive" },
      groupRootNames: new Set<string>(),
      commitView,
      setFiles: setFiles as DriveShellState["setFiles"],
      operations: {
        ...base.operations,
        localTree: true,
        renameItem,
      } as DriveShellState["operations"],
    });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));

    act(() => result.current.requestRenameItem(shell.files[0]));
    act(() => result.current.setRenameName("renamed"));
    act(() => result.current.submitRenameItem());
    await waitFor(() => expect(renameItem).toHaveBeenCalled());
    await Promise.resolve();

    expect(commitView).not.toHaveBeenCalled();
    // Only the optimistic rename: the reply's listing is not applied.
    expect(setFiles).toHaveBeenCalledTimes(1);
  });
});
