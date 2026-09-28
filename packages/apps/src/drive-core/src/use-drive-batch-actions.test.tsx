/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showToast } = vi.hoisted(() => ({
  showToast: vi.fn(() => "toast-1"),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: showToast,
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));
import type { DriveFile, ViewKey } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { useDriveBatchActions } from "@/drive-core/src/use-drive-batch-actions";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

const USER = "alice";
const NOTES_ID = "notes";

const queueMutation = vi.fn();
const reloadStarredFromServer = vi.fn();

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
  plugins: [],
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

function queued(): DeferredApiWriteArgs {
  const args = queueMutation.mock.calls[0]?.[0] as DeferredApiWriteArgs | undefined;
  if (!args) throw new Error("expected a queued drive batch");
  return args;
}

function renderActions(options?: {
  operations?: DriveAPIOperations;
  viewType?: ViewKey["type"];
  starred?: Record<string, boolean>;
  selectedIds?: string[];
  files?: DriveFile[];
}) {
  const viewType = options?.viewType ?? "folder";
  const view: ViewKey =
    viewType === "folder" ? { type: "folder", path: "My Drive" } : { type: viewType };
  const initialSelected = options?.selectedIds ?? [NOTES_ID];
  const initialFiles = options?.files ?? [driveFile()];
  return renderHook(() => {
    const [files, setFiles] = useState<DriveFile[]>(initialFiles);
    const [selectedIds, setSelectedIds] = useState(initialSelected);
    const [selectionMode, setSelectionMode] = useState(initialSelected.length > 0);
    const [activeId, setActiveId] = useState<string | null>(initialSelected[0] ?? null);
    const [, setDetailOpen] = useState(true);
    const [starred, setStarred] = useState(options?.starred ?? {});
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
      queueMutation,
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
      viewType,
    });
    return { files, selectedIds, selectionMode, starred, ...actions };
  });
}

describe("useDriveBatchActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("moves the selection to Trash and restores it on undo before the server call", () => {
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
      executeImmediately: true,
    });
    expect(operations.renameItem).not.toHaveBeenCalled();

    act(() => queued().undo());

    expect(result.current.files[0]?.parent).toBe("My Drive");
    expect(result.current.selectedIds).toEqual([NOTES_ID]);
    expect(result.current.selectionMode).toBe(true);
    expect(operations.renameItem).not.toHaveBeenCalled();
  });

  it("renames into Trash on execute and renames back when undo follows a finished move", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await queued().execute(new AbortController().signal);
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(operations.changeDir).toHaveBeenCalledWith(
      "/users/alice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      queued().undo();
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
      await queued().execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/notes.md",
        to: "notes 2.md",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      queued().undo();
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
      await expect(queued().execute(new AbortController().signal)).rejects.toThrow("rename failed");
    });

    await act(async () => {
      queued().undo();
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
      await queued().execute(new AbortController().signal);
    });

    await act(async () => {
      queued().undo();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/.Trash/notes.md",
      to: "notes 2.md",
    });
    expect(showToast).toHaveBeenCalledWith("Restored “notes.md” as “notes 2.md”");
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
      executeImmediately: true,
    });

    await act(async () => {
      await queued().execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/Projects",
        from: "/users/alice/notes.md",
        to: "notes.md",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      queued().undo();
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
      await expect(queued().execute(new AbortController().signal)).rejects.toThrow("rename failed");
    });

    await act(async () => {
      queued().undo();
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
      await queued().execute(new AbortController().signal);
    });

    await act(async () => {
      queued().undo();
    });

    expect(operations.renameItem).toHaveBeenLastCalledWith({
      destination: "/users/alice",
      from: "/users/alice/Projects/notes.md",
      to: "notes 2.md",
    });
    expect(showToast).toHaveBeenCalledWith("Restored “notes.md” as “notes 2.md”");
  });

  it("keeps a local trash move when there is no drive API", async () => {
    const { result } = renderActions();

    act(() => result.current.moveToTrash([NOTES_ID]));
    await act(async () => {
      await queued().execute(new AbortController().signal);
    });

    expect(result.current.files[0]?.parent).toBe("Trash");
    act(() => queued().undo());
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
      executeImmediately: true,
    });

    await act(async () => {
      await queued().execute(new AbortController().signal);
    });
    expect(operations.deleteItems).toHaveBeenCalledWith(
      ["/users/alice/notes.md"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() => queued().undo());

    expect(result.current.files.map((file) => file.id)).toEqual([NOTES_ID]);
    expect(result.current.selectedIds).toEqual([NOTES_ID]);
    expect(operations.deleteItems).toHaveBeenCalledTimes(1);
  });

  it("stars the selection through the deferred queue and restores the previous stars on undo", async () => {
    const operations = createOperations();
    const { result } = renderActions({ operations });

    act(() => result.current.batchStar());

    expect(result.current.starred[NOTES_ID]).toBe(true);
    expect(queued()).toMatchObject({
      key: "drive:batch-star:notes",
      toastMessage: "Starred 1",
      undoToastMessage: "Star changes undone.",
      executeImmediately: false,
    });
    expect(operations.setStar).not.toHaveBeenCalled();

    await act(async () => {
      await queued().execute(new AbortController().signal);
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/notes.md", starred: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(reloadStarredFromServer).not.toHaveBeenCalled();

    act(() => queued().undo());

    expect(result.current.starred).toEqual({});
    expect(operations.setStar).toHaveBeenCalledTimes(1);
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
      await queued().execute(new AbortController().signal);
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/notes.md", starred: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(reloadStarredFromServer).toHaveBeenCalledTimes(1);

    act(() => queued().undo());

    expect(result.current.starred[NOTES_ID]).toBe(true);
    expect(reloadStarredFromServer).toHaveBeenCalledTimes(2);
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
