import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";
import type { DriveShellState } from "./use-drive-shell";
import type { DriveListState } from "./use-drive-list";
import { useDriveMutations } from "./use-drive-mutations";

const toast = vi.hoisted(() => ({ show: vi.fn(), showError: vi.fn() }));
vi.mock("@/hooks/use-app-toast", () => ({ useAppToast: () => toast }));

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

  it("says the files were added, and says Uploaded only once they are on the server", async () => {
    toast.show.mockClear();
    let emit: (snapshot: DriveUploadQueueSnapshot) => void = () => undefined;
    const watchUploadQueue = vi.fn((listener: typeof emit) => {
      emit = listener;
      return () => undefined;
    });
    const queued = (ids: string[]): DriveUploadQueueSnapshot => ({
      state: ids.length ? "running" : "idle",
      items: ids.map((id) => ({
        id,
        batchId: "batch-1",
        name: `${id}.txt`,
        targetFolder: { kind: "server", id: "fn" },
        status: "queued",
        bytesDone: 0,
        bytesTotal: 1,
        localCopy: true,
        createdAt: 1,
        canRetry: false,
      })),
      batches: [],
      hasItems: ids.length > 0,
      totalBytes: ids.length,
    });
    const shell = buildShell({
      enqueueUploads: vi.fn().mockResolvedValue({ batchId: "batch-1", itemIds: ["a", "b"] }),
      releaseUploadBatch: vi.fn().mockResolvedValue(undefined),
      watchUploadQueue,
    });
    const { result } = renderHook(() => useDriveMutations({ shell, list: buildList() }));

    act(() => {
      result.current.handleUpload(fileList([new File(["a"], "a.txt"), new File(["b"], "b.txt")]));
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith("Added 2 files to uploads", expect.anything()),
    );

    act(() => emit(queued(["a", "b"])));
    act(() => emit(queued(["b"])));
    expect(toast.show).toHaveBeenCalledTimes(1);
    act(() => emit(queued([])));
    expect(toast.show).toHaveBeenLastCalledWith("Uploaded 2 files", expect.anything());
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
