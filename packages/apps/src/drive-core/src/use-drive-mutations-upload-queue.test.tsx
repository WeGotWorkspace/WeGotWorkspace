import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DriveShellState } from "./use-drive-shell";
import type { DriveListState } from "./use-drive-list";
import { useDriveMutations } from "./use-drive-mutations";

function buildShell(
  operations: Partial<NonNullable<DriveShellState["operations"]>>,
): DriveShellState {
  return {
    labels: {},
    data: { user: { username: "testuser", name: "t", role: "user", roots: [] } },
    files: [],
    setFiles: vi.fn(),
    view: { type: "folder", path: "My Drive" },
    commitView: vi.fn(),
    currentUsername: "testuser",
    groupRootNames: [],
    operations: {
      uploadFiles: vi.fn(),
      checkUploadReady: vi.fn().mockResolvedValue(undefined),
      ...operations,
    } as DriveShellState["operations"],
    starred: {},
    setStarred: vi.fn(),
    reloadStarredFromServer: vi.fn(),
    inTrashView: false,
    isUnderTrash: vi.fn(() => false),
  } as unknown as DriveShellState;
}

function buildList(): DriveListState {
  return {
    selectedIds: [],
    setSelectedIds: vi.fn(),
    selectionMode: false,
    setSelectionMode: vi.fn(),
    activeId: "",
    setActiveId: vi.fn(),
    setDetailOpen: vi.fn(),
    fileById: () => null,
    exitSelection: vi.fn(),
    dropZoneProps: vi.fn(),
    queueMutation: vi.fn(),
    beginOptimisticUpdate: vi.fn(),
  } as unknown as DriveListState;
}

function fileList(files: File[]): FileList {
  return Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
}

describe("useDriveMutations upload action", () => {
  it("queues the picked files locally and releases the batch instead of uploading directly", async () => {
    const enqueueUploads = vi.fn().mockResolvedValue({ batchId: "batch-1" });
    const releaseUploadBatch = vi.fn().mockResolvedValue(undefined);
    const uploadFiles = vi.fn();
    const shell = buildShell({ enqueueUploads, releaseUploadBatch, uploadFiles });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));
    const picked = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    act(() => {
      result.current.handleUpload(fileList(picked));
    });

    await waitFor(() =>
      expect(releaseUploadBatch).toHaveBeenCalledWith("batch-1", { keepOffline: "remove" }),
    );
    expect(enqueueUploads).toHaveBeenCalledWith({ cwd: "/users/testuser", files: picked });
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(result.current.uploadProgress).toBeNull();
  });

  it("keeps the direct upload path when the operations have no queue (mock)", async () => {
    const uploadFiles = vi.fn().mockResolvedValue({
      user: { username: "testuser", name: "t", role: "user", roots: [] },
      cwd: "/users/testuser",
      directory: { location: "/users/testuser", files: [] },
    });
    const shell = buildShell({ uploadFiles });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));

    act(() => {
      result.current.handleUpload(fileList([new File(["a"], "a.txt")]));
    });

    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
  });
});
