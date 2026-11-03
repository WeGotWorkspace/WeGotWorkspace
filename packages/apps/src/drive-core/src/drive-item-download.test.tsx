import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveFileItemActions } from "@/drive-core/src/drive-file-actions";
import {
  canDownloadDriveItem,
  DriveFolderDownloadContext,
  startDriveItemDownload,
} from "@/drive-core/src/drive-item-download";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { useDriveSelectionBar } from "@/drive-core/src/use-drive-selection-bar";

afterEach(() => {
  cleanup();
});

const FILE: DriveFile = {
  id: "1",
  category: "document",
  date: "Now",
  title: "Notes.md",
  excerpt: "",
  body: [],
  notebook: "",
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "2.0 KB",
  apiPath: "/users/alice/Notes.md",
};

const FOLDER: DriveFile = {
  ...FILE,
  id: "2",
  title: "Projects",
  kind: "folder",
  size: "",
  apiPath: "/users/alice/Projects",
};

function operations(withFolders: boolean) {
  return {
    downloadFile: vi.fn(async () => undefined),
    ...(withFolders ? { downloadFolder: vi.fn(async () => undefined) } : {}),
  } as unknown as DriveAPIOperations & {
    downloadFile: ReturnType<typeof vi.fn>;
    downloadFolder?: ReturnType<typeof vi.fn>;
  };
}

describe("canDownloadDriveItem", () => {
  it("always offers a file, also in trash", () => {
    expect(canDownloadDriveItem(FILE, { foldersDownloadable: false, inTrash: false })).toBe(true);
    expect(canDownloadDriveItem(FILE, { foldersDownloadable: false, inTrash: true })).toBe(true);
  });

  it("offers a folder only when folders can be downloaded and it is not in trash", () => {
    expect(canDownloadDriveItem(FOLDER, { foldersDownloadable: true, inTrash: false })).toBe(true);
    expect(canDownloadDriveItem(FOLDER, { foldersDownloadable: false, inTrash: false })).toBe(
      false,
    );
    expect(canDownloadDriveItem(FOLDER, { foldersDownloadable: true, inTrash: true })).toBe(false);
  });
});

describe("startDriveItemDownload", () => {
  it("sends a folder to downloadFolder and a file to downloadFile", () => {
    const ops = operations(true);
    startDriveItemDownload(ops, FOLDER, vi.fn());
    startDriveItemDownload(ops, FILE, vi.fn());

    expect(ops.downloadFolder).toHaveBeenCalledWith("/users/alice/Projects");
    expect(ops.downloadFile).toHaveBeenCalledWith("/users/alice/Notes.md");
    expect(ops.downloadFile).toHaveBeenCalledOnce();
  });

  it("reports a failure to start as a message", async () => {
    const ops = operations(true);
    ops.downloadFolder?.mockRejectedValueOnce(new Error("Folder not found"));
    const onError = vi.fn();
    const onStarted = vi.fn();

    startDriveItemDownload(ops, FOLDER, onError, onStarted);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Folder not found"));
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("says a file download started at once", () => {
    const onStarted = vi.fn();

    startDriveItemDownload(operations(true), FILE, vi.fn(), onStarted);
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("says a folder download started only once the browser has the zip", async () => {
    const ops = operations(true);
    const onStarted = vi.fn();

    startDriveItemDownload(ops, FOLDER, vi.fn(), onStarted);
    expect(onStarted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
  });
});

function renderRowMenu(file: DriveFile, foldersDownloadable: boolean, inTrash = false) {
  const onDownload = vi.fn();
  render(
    <DriveFolderDownloadContext.Provider value={foldersDownloadable}>
      <DriveFileItemActions
        labels={driveLabels}
        file={file}
        isStarred={false}
        inTrash={inTrash}
        onDownload={onDownload}
        onStar={vi.fn()}
        onDelete={vi.fn()}
      />
    </DriveFolderDownloadContext.Provider>,
  );
  const trigger = screen.getByRole("button", { name: "More actions" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  return onDownload;
}

describe("row menu", () => {
  it("offers Download as zip on a folder when folders can be downloaded", () => {
    const onDownload = renderRowMenu(FOLDER, true);

    fireEvent.click(screen.getByRole("menuitem", { name: driveLabels.detailDownloadFolder }));
    expect(onDownload).toHaveBeenCalledWith(FOLDER);
  });

  it("offers no download on a folder without folder downloads or in trash", () => {
    renderRowMenu(FOLDER, false);
    expect(screen.queryByRole("menuitem", { name: driveLabels.detailDownloadFolder })).toBeNull();
    cleanup();

    renderRowMenu(FOLDER, true, true);
    expect(screen.queryByRole("menuitem", { name: driveLabels.detailDownloadFolder })).toBeNull();
  });

  it("keeps Download on a file", () => {
    renderRowMenu(FILE, true);
    expect(screen.getByRole("menuitem", { name: driveLabels.detailDownload })).toBeTruthy();
  });
});

function selectionLabels(
  file: DriveFile,
  ops: DriveAPIOperations,
  inTrashView = false,
): { labels: string[]; click: (label: string) => void } {
  const { result } = renderHook(() =>
    useDriveSelectionBar({
      labels: driveLabels,
      files: [file],
      selectedIds: [file.id],
      selectionMode: true,
      activeId: null,
      inTrashView,
      operations: ops,
      exitSelection: vi.fn(),
      batchStar: vi.fn(),
      requestDeleteSelected: vi.fn(),
      requestMoveSelected: vi.fn(),
    }),
  );
  const buttons = result.current.selectionBarButtons;
  return {
    labels: buttons.map((button) => button.label),
    click: (label) => buttons.find((button) => button.label === label)?.onClick?.(),
  };
}

describe("selection bar", () => {
  it("offers Download as zip for one selected folder and starts the folder download", () => {
    const ops = operations(true);
    const bar = selectionLabels(FOLDER, ops);

    expect(bar.labels).toContain(driveLabels.selectionDownloadFolder);
    bar.click(driveLabels.selectionDownloadFolder);
    expect(ops.downloadFolder).toHaveBeenCalledWith("/users/alice/Projects");
    expect(ops.downloadFile).not.toHaveBeenCalled();
  });

  it("offers no folder download without downloadFolder or in trash", () => {
    expect(selectionLabels(FOLDER, operations(false)).labels).not.toContain(
      driveLabels.selectionDownloadFolder,
    );
    expect(selectionLabels(FOLDER, operations(true), true).labels).not.toContain(
      driveLabels.selectionDownloadFolder,
    );
  });

  it("keeps Download for one selected file", () => {
    const ops = operations(true);
    const bar = selectionLabels(FILE, ops);

    expect(bar.labels).toContain(driveLabels.selectionDownload);
    bar.click(driveLabels.selectionDownload);
    expect(ops.downloadFile).toHaveBeenCalledWith("/users/alice/Notes.md");
  });
});
