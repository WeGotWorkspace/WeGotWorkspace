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
});
