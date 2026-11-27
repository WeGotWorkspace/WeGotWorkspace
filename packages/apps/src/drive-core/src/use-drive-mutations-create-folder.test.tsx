import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("on the local tree a create or rename keeps the open folder and its rows", async () => {
    const base = buildShell({ view: { type: "folder", path: "My Drive/Projects" } });
    const projectsRow: DriveFile = {
      ...base.files[0]!,
      id: "p-1",
      title: "plan.md",
      parent: "My Drive/Projects",
      apiPath: "/users/testuser/Projects/plan.md",
    };
    let rows: DriveFile[] = [projectsRow];
    const setFiles = vi.fn((update: DriveFile[] | ((previous: DriveFile[]) => DriveFile[])) => {
      rows = typeof update === "function" ? update(rows) : update;
    });
    // The live client answers with its bootstrap folder (My Drive), not the open one.
    const myDrive = {
      ...base.data,
      cwd: "/users/testuser",
      directory: { location: "/users/testuser", files: [] },
    };
    const createFolder = vi.fn().mockResolvedValue(myDrive);
    const renameItem = vi.fn().mockResolvedValue(myDrive);
    const commitView = vi.fn();
    const shell = buildShell({
      view: { type: "folder", path: "My Drive/Projects" },
      groupRootNames: new Set<string>(),
      files: rows,
      setFiles: setFiles as DriveShellState["setFiles"],
      commitView,
      operations: {
        ...base.operations,
        localTree: true,
        createFolder,
        renameItem,
      } as DriveShellState["operations"],
    });
    const list = buildList({ fileById: (id: string) => rows.find((row) => row.id === id) ?? null });
    const { result } = renderHook(() => useDriveMutations({ shell, list }));

    act(() => result.current.submitCreateFolder("Drafts", "My Drive/Projects"));
    await waitFor(() => expect(createFolder).toHaveBeenCalled());
    // The tree read shows the created folder; the optimistic row goes.
    await waitFor(() => expect(rows.map((row) => row.title)).toEqual(["plan.md"]));

    act(() => result.current.requestRenameItem(projectsRow));
    act(() => result.current.setRenameName("roadmap"));
    act(() => result.current.submitRenameItem());
    await waitFor(() => expect(renameItem).toHaveBeenCalled());
    await Promise.resolve();
    expect(rows.map((row) => row.title)).toEqual(["roadmap.md"]);
    expect(commitView).not.toHaveBeenCalled();
  });
});
