/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showToast, showErrorToast, dismissToast } = vi.hoisted(() => ({
  showToast: vi.fn(() => "toast-1"),
  showErrorToast: vi.fn(() => "toast-err"),
  dismissToast: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: showToast,
    dismiss: dismissToast,
    showSuccess: vi.fn(),
    showError: showErrorToast,
  }),
}));
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { useDriveBatchActions } from "@/drive-core/src/use-drive-batch-actions";
import { useQueuedMutation, type QueuedMutationArgs } from "@/hooks/use-queued-mutation";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

const USER = "alice";
const NOTES_ID = "notes";

const queueMutation = vi.fn();
const reloadStarredFromServer = vi.fn();
const reloadAllFiles = vi.fn();

function listedFile(path: string, name = path.split("/").pop() ?? path) {
  return {
    name,
    path,
    type: "file" as const,
    size: 100,
    time: 1,
    permissions: 644,
    myRights: fullDriveMyRights,
  };
}

const EMPTY_DRIVE_UI: DriveUIData = {
  user: { username: USER, name: USER, role: "user", roots: ["/users"] },
  cwd: `/users/${USER}`,
  directory: { location: `/users/${USER}`, files: [] },
};

function driveFile(overrides?: Partial<DriveFile>): DriveFile {
  const title = overrides?.title ?? "notes.md";
  return {
    id: NOTES_ID,
    title,
    parent: "My Drive",
    apiPath: `/users/alice/${title}`,
    notebook: "",
    category: "",
    date: "",
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    kind: "file",
    size: "1 KB",
    ...overrides,
  };
}

function createOperations(): DriveAPIOperations {
  return {
    refreshState: vi.fn(async () => EMPTY_DRIVE_UI),
    changeDir: vi.fn(async () => EMPTY_DRIVE_UI),
    listDirectory: vi.fn(async () => EMPTY_DRIVE_UI),
    listAllDirectoryEntries: vi.fn(async () => []),
    search: vi.fn(async () => []),
    createFolder: vi.fn(async () => EMPTY_DRIVE_UI),
    createFile: vi.fn(async () => EMPTY_DRIVE_UI),
    renameItem: vi.fn(async () => EMPTY_DRIVE_UI),
    deleteItems: vi.fn(async () => EMPTY_DRIVE_UI),
    downloadFile: vi.fn(async () => undefined),
    readFileBlob: vi.fn(async () => new Blob()),
    checkUploadReady: vi.fn(async () => undefined),
    listStars: vi.fn(async () => []),
    listEntriesByPaths: vi.fn(async () => []),
    setStar: vi.fn(async () => undefined),
    uploadFiles: vi.fn(async () => EMPTY_DRIVE_UI),
  };
}

function queued(): QueuedMutationArgs {
  const args = queueMutation.mock.calls[0]?.[0] as QueuedMutationArgs | undefined;
  if (!args) throw new Error("expected a queued drive batch");
  return args;
}

let completedKeys = new Set<string>();

/** Runs the queued write as `useQueuedMutation` does, recording what the server applied. */
async function executeQueued(signal = new AbortController().signal): Promise<void> {
  const args = queued();
  completedKeys = new Set();
  if (args.irreversible) return args.execute(signal);
  return args.execute(signal, (key) => completedKeys.add(key));
}

/** Undo as `useQueuedMutation` does it: the screen first, then the revert of what landed. */
async function undoQueued(): Promise<void> {
  const args = queued();
  args.undo();
  if (!args.irreversible) await args.revert(new Set(completedKeys));
}

function renderActions(options?: {
  operations?: DriveAPIOperations;
  viewType?: ViewKey["type"];
  starred?: Record<string, boolean>;
  selectedIds?: string[];
  files?: DriveFile[];
  /** Rows a view lists outside the open folder, like Shared with me. */
  otherRows?: DriveFile[];
  liveQueue?: boolean;
  /** All Files rows: listed apart from the open folder. */
  allRows?: DriveFile[];
}) {
  const viewType = options?.viewType ?? "folder";
  const view: ViewKey =
    viewType === "folder" ? { type: "folder", path: "My Drive" } : { type: viewType };
  const initialSelected = options?.selectedIds ?? [NOTES_ID];
  const initialFiles = options?.files ?? [driveFile()];
  return renderHook(() => {
    const live = useQueuedMutation({ onMutationError: () => undefined });
    const [files, setFiles] = useState<DriveFile[]>(initialFiles);
    const [selectedIds, setSelectedIds] = useState(initialSelected);
    const [selectionMode, setSelectionMode] = useState(initialSelected.length > 0);
    const [activeId, setActiveId] = useState<string | null>(initialSelected[0] ?? null);
    const [, setDetailOpen] = useState(true);
    const [starred, setStarred] = useState(options?.starred ?? {});
    const [allRows, setAllRows] = useState<DriveFile[] | null>(options?.allRows ?? null);
    const actions = useDriveBatchActions({
      files,
      setFiles,
      selectedIds,
      setSelectedIds,
      selectionMode,
      setSelectionMode,
      activeId,
      setActiveId,
      setDetailOpen,
      starred,
      setStarred,
      currentUsername: USER,
      groupRootNames: new Set(),
      operations: options?.operations,
      queueMutation: options?.liveQueue ? live.queueMutation : queueMutation,
      beginOptimisticUpdate: ({ ids, updater }) => {
        const snapshot = files.filter((file) => ids.includes(file.id));
        setFiles((prev) => prev.map((file) => (ids.includes(file.id) ? updater(file) : file)));
        const snapshotById = new Map(snapshot.map((file) => [file.id, file]));
        return {
          snapshotById,
          affectedItems: snapshot,
          rollback: () => {
            setFiles((prev) => prev.map((file) => snapshotById.get(file.id) ?? file));
          },
        };
      },
      reloadStarredFromServer,
      view,
      fileById: (id) =>
        [...files, ...(options?.otherRows ?? []), ...(allRows ?? [])].find(
          (file) => file.id === id,
        ) ?? null,
      allFiles: {
        patchAllFiles: (update) => setAllRows((prev) => (prev ? update(prev) : prev)),
        reloadAllFiles,
      },
    });
    return {
      files,
      allRows,
      selectedIds,
      selectionMode,
      starred,
      undoLatest: live.undoLatest,
      ...actions,
    };
  });
}

describe("useDriveBatchActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completedKeys = new Set();
  });

  afterEach(() => {
    cleanup();
  });

  it("deletes a foreign shared file instead of renaming it and skips undo", async () => {
    const operations = createOperations();
    const foreign = driveFile({
      id: "shared",
      title: "plan.md",
      parent: "Users/bob/workspace",
      apiPath: "/users/bob/workspace/plan.md",
    });
    const { result } = renderActions({
      operations,
      files: [foreign],
      selectedIds: ["shared"],
    });

    act(() => result.current.moveToTrash(["shared"]));
    expect(queued()).toMatchObject({ irreversible: true });
    await act(async () => {
      await executeQueued();
    });

    expect(operations.deleteItems).toHaveBeenCalledWith(["/users/bob/workspace/plan.md"], {
      refreshState: false,
      signal: expect.any(AbortSignal),
    });
    expect(operations.renameItem).not.toHaveBeenCalled();

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).not.toHaveBeenCalled();
    expect(operations.deleteItems).toHaveBeenCalledTimes(1);
  });

  it("holds a batch with a shared item for the grace period, and Undo cancels all of it", async () => {
    vi.useFakeTimers();
    try {
      const operations = createOperations();
      const foreign = driveFile({
        id: "shared",
        title: "plan.md",
        parent: "Users/bob/workspace",
        apiPath: "/users/bob/workspace/plan.md",
      });
      const { result } = renderActions({
        operations,
        liveQueue: true,
        files: [driveFile(), foreign],
        selectedIds: [NOTES_ID, "shared"],
      });

      act(() => result.current.moveToTrash([NOTES_ID, "shared"]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(operations.renameItem).not.toHaveBeenCalled();
      expect(operations.deleteItems).not.toHaveBeenCalled();

      act(() => {
        result.current.undoLatest();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(operations.renameItem).not.toHaveBeenCalled();
      expect(operations.deleteItems).not.toHaveBeenCalled();
      expect(result.current.files.map((file) => file.parent)).toEqual([
        "My Drive",
        "Users/bob/workspace",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a permanent delete only after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const operations = createOperations();
      const { result } = renderActions({ operations, liveQueue: true });

      act(() => result.current.reallyDelete([NOTES_ID]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2400);
      });
      expect(operations.deleteItems).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(operations.deleteItems).toHaveBeenCalledWith(
        ["/users/alice/notes.md"],
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("trashes own files at once, without waiting for a grace period", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations, liveQueue: true });

    act(() => result.current.moveToTrash([NOTES_ID]));

    await vi.waitFor(() => {
      expect(operations.renameItem).toHaveBeenCalledTimes(1);
    });
  });

  it("moves the selection to Trash and restores it on undo before the server call", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));

    expect(result.current.files[0]?.parent).toBe("Trash");
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectionMode).toBe(false);
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queued()).toMatchObject({
      key: "drive:trash:notes",
      toastMessage: "Moved 1 to Trash",
      undoToastMessage: "Move to trash undone.",
      revert: expect.any(Function),
    });
    expect(operations.renameItem).not.toHaveBeenCalled();

    await act(async () => {
      await undoQueued();
    });

    expect(result.current.files[0]?.parent).toBe("My Drive");
    expect(result.current.selectedIds).toEqual([NOTES_ID]);
    expect(result.current.selectionMode).toBe(true);
    expect(operations.renameItem).not.toHaveBeenCalled();
  });

  it("restores a trash rename that resolves after undo", async () => {
    const operations = createOperations();
    let releaseRename: () => void = () => undefined;
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let forwardRename = true;
    vi.mocked(operations.renameItem).mockImplementation(async () => {
      if (forwardRename) {
        forwardRename = false;
        await renameGate;
      }
      return EMPTY_DRIVE_UI;
    });
    const { result } = renderActions({ operations, liveQueue: true });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await vi.waitFor(() => {
      expect(operations.renameItem).toHaveBeenCalledTimes(1);
    });
    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/notes.md",
        to: "notes.md",
      },
      { refreshState: false },
    );

    act(() => {
      result.current.undoLatest();
    });
    releaseRename();

    await vi.waitFor(() => {
      expect(operations.renameItem).toHaveBeenCalledTimes(2);
    });
    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/notes.md",
      to: "notes.md",
    });
  });

  it("does not rename the next file when undo arrives during the first trash rename", async () => {
    const operations = createOperations();
    let releaseRename: () => void = () => undefined;
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let forwardRename = true;
    vi.mocked(operations.renameItem).mockImplementation(async () => {
      if (forwardRename) {
        forwardRename = false;
        await renameGate;
      }
      return EMPTY_DRIVE_UI;
    });
    const { result } = renderActions({
      operations,
      liveQueue: true,
      files: [driveFile(), driveFile({ id: "other", title: "other.md" })],
      selectedIds: [NOTES_ID, "other"],
    });

    act(() => result.current.moveToTrash([NOTES_ID, "other"]));
    await vi.waitFor(() => {
      expect(operations.renameItem).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.undoLatest();
    });
    releaseRename();

    await vi.waitFor(() => {
      expect(vi.mocked(operations.renameItem).mock.calls.map((call) => call[0])).toEqual([
        {
          destination: "/users/alice/.Trash",
          from: "/users/alice/notes.md",
          to: "notes.md",
        },
        {
          destination: "/users/alice",
          from: "/users/alice/.Trash/notes.md",
          to: "notes.md",
        },
      ]);
    });
    expect(operations.renameItem).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(operations.renameItem)
        .mock.calls.some(
          (call) => call[0].from.includes("other") || call[0].to.startsWith("other"),
        ),
    ).toBe(false);
  });

  it("renames into Trash on execute and renames back when undo follows a finished move", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await executeQueued();
    });

    expect(operations.createFolder).toHaveBeenCalledWith(
      { cwd: "/users/alice", name: ".Trash" },
      expect.objectContaining({ signal: expect.any(AbortSignal), refreshState: false }),
    );
    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/notes.md",
        to: "notes.md",
      },
      { refreshState: false },
    );
    expect(operations.changeDir).toHaveBeenCalledWith(
      "/users/alice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledTimes(2);
    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/notes.md",
      to: "notes.md",
    });
    expect(result.current.files[0]?.parent).toBe("My Drive");
  });

  it("restores a trashed file under the name Trash actually stored", async () => {
    const operations = createOperations();
    vi.mocked(operations.listAllDirectoryEntries!).mockImplementation(async (at: string) => {
      if (at.endsWith("/.Trash")) return [listedFile(`${at}/notes.md`, "notes.md")];
      return [];
    });
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await executeQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/notes.md",
        to: "notes 2.md",
      },
      { refreshState: false },
    );

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/notes 2.md",
      to: "notes.md",
    });
  });

  it("reverts only files already in Trash when a later rename throws", async () => {
    const operations = createOperations();
    vi.mocked(operations.renameItem)
      .mockResolvedValueOnce(EMPTY_DRIVE_UI)
      .mockRejectedValueOnce(new Error("rename failed"));
    const { result } = renderActions({
      operations,
      files: [driveFile(), driveFile({ id: "other", title: "other.md" })],
      selectedIds: [NOTES_ID, "other"],
    });

    act(() => result.current.moveToTrash([NOTES_ID, "other"]));
    await act(async () => {
      await expect(executeQueued()).rejects.toThrow("rename failed");
    });

    await act(async () => {
      await undoQueued();
    });

    const restores = vi
      .mocked(operations.renameItem)
      .mock.calls.filter((call) => call[0].destination === "/users/alice");
    expect(restores).toEqual([
      [{ destination: "/users/alice", from: "/users/alice/.Trash/notes.md", to: "notes.md" }],
    ]);
  });

  it("restores a trashed file under a free name when the original title is taken", async () => {
    const operations = createOperations();
    vi.mocked(operations.listAllDirectoryEntries!).mockImplementation(async (at: string) => {
      if (at === "/users/alice") return [listedFile("/users/alice/notes.md")];
      return [];
    });
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await executeQueued();
    });

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/notes.md",
      to: "notes 2.md",
    });
    expect(showToast).toHaveBeenCalledWith("Restored “notes.md” as “notes 2.md”");
  });

  it("reports several renamed restores in one toast", async () => {
    const operations = createOperations();
    vi.mocked(operations.listAllDirectoryEntries!).mockImplementation(async (at: string) => {
      if (at === "/users/alice") {
        return [listedFile("/users/alice/notes.md"), listedFile("/users/alice/other.md")];
      }
      return [];
    });
    const { result } = renderActions({
      operations,
      files: [driveFile(), driveFile({ id: "other", title: "other.md" })],
      selectedIds: [NOTES_ID, "other"],
    });

    act(() => result.current.moveToTrash([NOTES_ID, "other"]));
    await act(async () => {
      await executeQueued();
    });
    await act(async () => {
      await undoQueued();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Restored 2 files under a new name");
  });

  it("keeps restoring later files when one restore fails and reloads the folder", async () => {
    const operations = createOperations();
    vi.mocked(operations.listAllDirectoryEntries!).mockImplementation(async (at: string) => {
      if (at === "/users/alice") return [listedFile("/users/alice/notes.md")];
      return [];
    });
    vi.mocked(operations.renameItem)
      .mockResolvedValueOnce(EMPTY_DRIVE_UI)
      .mockResolvedValueOnce(EMPTY_DRIVE_UI)
      .mockResolvedValueOnce(EMPTY_DRIVE_UI)
      .mockRejectedValueOnce(new Error("restore failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderActions({
      operations,
      files: [driveFile(), driveFile({ id: "other", title: "other.md" })],
      selectedIds: [NOTES_ID, "other"],
    });

    act(() => result.current.moveToTrash([NOTES_ID, "other"]));
    await act(async () => {
      await executeQueued();
    });
    const refreshesBeforeUndo = vi.mocked(operations.changeDir).mock.calls.length;

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/other.md",
      to: "other.md",
    });
    expect(showToast).toHaveBeenCalledWith("Restored “notes.md” as “notes 2.md”");
    expect(showErrorToast).toHaveBeenCalledWith("Couldn't restore 1 file");
    expect(vi.mocked(operations.changeDir).mock.calls.length).toBeGreaterThan(refreshesBeforeUndo);
    consoleError.mockRestore();
  });

  it("does not fail the trash batch when the folder refresh fails", async () => {
    const operations = createOperations();
    vi.mocked(operations.changeDir).mockRejectedValue(new Error("refresh failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await executeQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Drive folder refresh failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it("renames into the destination folder and renames back when undo follows a finished move", async () => {
    const operations = createOperations();
    let refreshes = 0;
    vi.mocked(operations.changeDir).mockImplementation(async () => {
      refreshes += 1;
      if (refreshes === 1) return EMPTY_DRIVE_UI;
      return {
        ...EMPTY_DRIVE_UI,
        directory: {
          location: "/users/alice",
          files: [listedFile("/users/alice/notes.md")],
        },
      };
    });
    const { result } = renderActions({ operations });

    act(() => result.current.moveToFolder([NOTES_ID], "My Drive/Projects"));

    expect(result.current.files[0]?.parent).toBe("My Drive/Projects");
    expect(queued()).toMatchObject({
      key: "drive:move:My Drive/Projects:notes",
      toastMessage: "Moved 1 to Projects",
      undoToastMessage: "Move undone.",
      revert: expect.any(Function),
    });

    await act(async () => {
      await executeQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/Projects",
        from: "/users/alice/notes.md",
        to: "notes.md",
      },
      { refreshState: false },
    );

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledTimes(2);
    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/Projects/notes.md",
      to: "notes.md",
    });
    expect(result.current.files[0]?.parent).toBe("My Drive");
  });

  it("reverts only files already moved when a later rename throws", async () => {
    const operations = createOperations();
    vi.mocked(operations.renameItem)
      .mockResolvedValueOnce(EMPTY_DRIVE_UI)
      .mockRejectedValueOnce(new Error("rename failed"));
    const { result } = renderActions({
      operations,
      files: [driveFile(), driveFile({ id: "other", title: "other.md" })],
      selectedIds: [NOTES_ID, "other"],
    });

    act(() => result.current.moveToFolder([NOTES_ID, "other"], "My Drive/Projects"));
    await act(async () => {
      await expect(executeQueued()).rejects.toThrow("rename failed");
    });

    await act(async () => {
      await undoQueued();
    });

    const restores = vi
      .mocked(operations.renameItem)
      .mock.calls.filter((call) => call[0].from.startsWith("/users/alice/Projects/"));
    expect(restores).toEqual([
      [
        {
          destination: "/users/alice",
          from: "/users/alice/Projects/notes.md",
          to: "notes.md",
        },
      ],
    ]);
  });

  it("restores a moved file under a free name when the original title is taken", async () => {
    const operations = createOperations();
    vi.mocked(operations.listAllDirectoryEntries!).mockImplementation(async (at: string) => {
      if (at === "/users/alice") return [listedFile("/users/alice/notes.md")];
      return [];
    });
    const { result } = renderActions({ operations });

    act(() => result.current.moveToFolder([NOTES_ID], "My Drive/Projects"));
    await act(async () => {
      await executeQueued();
    });

    await act(async () => {
      await undoQueued();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/Projects/notes.md",
      to: "notes 2.md",
    });
    expect(showToast).toHaveBeenCalledWith("Restored “notes.md” as “notes 2.md”");
  });

  it("does not fail the move batch when the folder refresh fails", async () => {
    const operations = createOperations();
    vi.mocked(operations.changeDir).mockRejectedValue(new Error("refresh failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderActions({ operations });

    act(() => result.current.moveToFolder([NOTES_ID], "My Drive/Projects"));
    await act(async () => {
      await executeQueued();
    });

    expect(operations.renameItem).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Drive folder refresh failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it("keeps a local trash move when there is no drive API", async () => {
    const { result } = renderActions();

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await executeQueued();
    });

    expect(result.current.files[0]?.parent).toBe("Trash");
    await act(async () => {
      await undoQueued();
    });
    expect(result.current.files[0]?.parent).toBe("My Drive");
  });

  it("deletes the selection and restores it on undo without a second delete", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.reallyDelete([NOTES_ID]));

    expect(result.current.files).toEqual([]);
    expect(queued()).toMatchObject({
      key: "drive:delete:notes",
      toastMessage: "Deleted 1 file",
      undoToastMessage: "Deletion undone.",
      irreversible: true,
    });

    await act(async () => {
      await executeQueued();
    });
    expect(operations.deleteItems).toHaveBeenCalledWith(
      ["/users/alice/notes.md"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await undoQueued();
    });

    expect(result.current.files.map((file) => file.id)).toEqual([NOTES_ID]);
    expect(result.current.selectedIds).toEqual([NOTES_ID]);
    expect(operations.deleteItems).toHaveBeenCalledTimes(1);
  });

  it("stars the selection at once and sends the previous stars back on undo", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.batchStar());

    expect(result.current.starred[NOTES_ID]).toBe(true);
    expect(queued()).toMatchObject({
      key: "drive:batch-star:notes",
      toastMessage: "Starred 1",
      undoToastMessage: "Star changes undone.",
      revert: expect.any(Function),
    });
    expect(operations.setStar).not.toHaveBeenCalled();

    await act(async () => {
      await executeQueued();
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/notes.md", starred: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Starred also lists items outside the open folder, so it refreshes from any view.
    expect(reloadStarredFromServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      await undoQueued();
    });

    expect(result.current.starred).toEqual({});
    expect(operations.setStar).toHaveBeenCalledTimes(2);
    expect(operations.setStar).toHaveBeenLastCalledWith({
      path: "/users/alice/notes.md",
      starred: false,
    });
  });

  it("stars a selected row that is not in the open folder", async () => {
    const operations = createOperations();
    const { result } = renderActions({
      operations,
      viewType: "shared",
      files: [],
      otherRows: [driveFile()],
    });

    act(() => result.current.batchStar());

    expect(result.current.starred[NOTES_ID]).toBe(true);
    await act(async () => {
      await executeQueued();
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/notes.md", starred: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("unstars a fully starred selection and reloads the starred view", async () => {
    const operations = createOperations();
    const { result } = renderActions({
      operations,
      viewType: "starred",
      starred: { [NOTES_ID]: true },
    });

    act(() => result.current.batchStar());

    expect(result.current.starred[NOTES_ID]).toBe(false);
    expect(queued().toastMessage).toBe("Unstarred 1");

    await act(async () => {
      await executeQueued();
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/notes.md", starred: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(reloadStarredFromServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      await undoQueued();
    });

    expect(result.current.starred[NOTES_ID]).toBe(true);
    expect(operations.setStar).toHaveBeenLastCalledWith({
      path: "/users/alice/notes.md",
      starred: true,
    });
    expect(reloadStarredFromServer).toHaveBeenCalledTimes(3);
  });

  describe("All Files rows outside the open folder", () => {
    const reportRow = () =>
      driveFile({
        id: "report",
        title: "report.md",
        parent: "My Drive/Projects",
        apiPath: "/users/alice/Projects/report.md",
      });

    it("trashes the row, hides it at once and reloads All Files", async () => {
      const operations = createOperations();
      const { result } = renderActions({
        operations,
        viewType: "all",
        files: [],
        allRows: [reportRow(), driveFile({ id: "keep", title: "keep.md" })],
        selectedIds: ["report"],
      });

      act(() => result.current.moveToTrash(["report"]));

      expect(result.current.allRows?.map((file) => file.id)).toEqual(["keep"]);
      await act(async () => {
        await executeQueued();
      });
      expect(operations.renameItem).toHaveBeenCalledWith(
        expect.objectContaining({ from: "/users/alice/Projects/report.md" }),
        expect.anything(),
      );
      expect(reloadAllFiles).toHaveBeenCalled();
    });

    it("brings the row back on undo", async () => {
      const operations = createOperations();
      const { result } = renderActions({
        operations,
        viewType: "all",
        files: [],
        allRows: [reportRow()],
        selectedIds: ["report"],
      });

      act(() => result.current.moveToTrash(["report"]));
      reloadAllFiles.mockClear();
      await act(async () => {
        await undoQueued();
      });

      expect(result.current.allRows?.map((file) => file.id)).toEqual(["report"]);
      expect(reloadAllFiles).toHaveBeenCalled();
    });

    it("deletes the row for good and reloads All Files", async () => {
      const operations = createOperations();
      const { result } = renderActions({
        operations,
        viewType: "all",
        files: [],
        allRows: [reportRow()],
        selectedIds: ["report"],
      });

      act(() => result.current.reallyDelete(["report"]));

      expect(result.current.allRows).toEqual([]);
      await act(async () => {
        await executeQueued();
      });
      expect(operations.deleteItems).toHaveBeenCalledWith(
        ["/users/alice/Projects/report.md"],
        expect.anything(),
      );
      expect(reloadAllFiles).toHaveBeenCalled();
    });

    it("moves the row to another folder and reloads All Files", async () => {
      const operations = createOperations();
      const { result } = renderActions({
        operations,
        viewType: "all",
        files: [],
        allRows: [reportRow()],
        selectedIds: ["report"],
      });

      act(() => result.current.moveToFolder(["report"], "My Drive/Archive"));

      expect(result.current.allRows?.[0]?.parent).toBe("My Drive/Archive");
      await act(async () => {
        await executeQueued();
      });
      expect(operations.renameItem).toHaveBeenCalledWith(
        expect.objectContaining({ from: "/users/alice/Projects/report.md" }),
        expect.anything(),
      );
      expect(reloadAllFiles).toHaveBeenCalled();
    });
  });

  it("ignores empty trash and delete requests", () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => {
      result.current.moveToTrash([]);
      result.current.reallyDelete(["missing"]);
    });

    expect(queueMutation).not.toHaveBeenCalled();
    expect(result.current.files).toHaveLength(1);
  });

  it("ignores star when nothing is selected", () => {
    const operations = createOperations();
    const { result } = renderActions({ operations, selectedIds: [] });

    act(() => result.current.batchStar());

    expect(queueMutation).not.toHaveBeenCalled();
  });
});
