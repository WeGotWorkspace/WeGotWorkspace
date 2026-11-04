import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canDownloadDriveSelection,
  startDriveSelectionDownload,
} from "@/drive-core/src/drive-item-download";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { useDriveSelectionBar } from "@/drive-core/src/use-drive-selection-bar";

// Several selected items download as one zip (#1905).

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

const OTHER: DriveFile = { ...FILE, id: "3", title: "Plan.md", apiPath: "/users/alice/Plan.md" };

type Ops = DriveAPIOperations & {
  downloadFile: ReturnType<typeof vi.fn>;
  downloadFolder?: ReturnType<typeof vi.fn>;
  downloadSelection?: ReturnType<typeof vi.fn>;
};

function operations(withSelection = true): Ops {
  return {
    downloadFile: vi.fn(async () => undefined),
    downloadFolder: vi.fn(async () => undefined),
    ...(withSelection ? { downloadSelection: vi.fn(async () => undefined) } : {}),
  } as unknown as Ops;
}

function bar(
  files: DriveFile[],
  ops: DriveAPIOperations,
  options: { inTrashView?: boolean; zipName?: string; selectedIds?: string[] } = {},
): { labels: string[]; click: (label: string) => void } {
  const { result } = renderHook(() =>
    useDriveSelectionBar({
      labels: driveLabels,
      files,
      selectedIds: options.selectedIds ?? files.map((file) => file.id),
      selectionMode: true,
      activeId: null,
      inTrashView: options.inTrashView ?? false,
      operations: ops,
      zipName: options.zipName,
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

describe("canDownloadDriveSelection", () => {
  const offered = { selectionDownloadable: true, inTrash: false };

  it("offers two or more items with API paths", () => {
    expect(canDownloadDriveSelection([FILE, FOLDER], offered)).toBe(true);
    expect(canDownloadDriveSelection([FILE], offered)).toBe(false);
    expect(canDownloadDriveSelection([], offered)).toBe(false);
  });

  it("offers nothing in trash, without selection zips, or with an unknown or pathless item", () => {
    expect(canDownloadDriveSelection([FILE, FOLDER], { ...offered, inTrash: true })).toBe(false);
    expect(
      canDownloadDriveSelection([FILE, FOLDER], { ...offered, selectionDownloadable: false }),
    ).toBe(false);
    expect(canDownloadDriveSelection([FILE, undefined], offered)).toBe(false);
    expect(canDownloadDriveSelection([FILE, { ...FOLDER, apiPath: undefined }], offered)).toBe(
      false,
    );
  });
});

describe("startDriveSelectionDownload", () => {
  it("sends the paths and zip name, and says it started once the browser has the zip", async () => {
    const ops = operations();
    const onStarted = vi.fn();

    startDriveSelectionDownload(ops, [FILE, FOLDER], "Personal", vi.fn(), onStarted);

    expect(ops.downloadSelection).toHaveBeenCalledWith(
      ["/users/alice/Notes.md", "/users/alice/Projects"],
      "Personal",
    );
    expect(onStarted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
  });

  it("reports a failure as a message", async () => {
    const ops = operations();
    ops.downloadSelection?.mockRejectedValueOnce(
      new Error("Downloading a folder as a zip needs a connection."),
    );
    const onError = vi.fn();
    const onStarted = vi.fn();

    startDriveSelectionDownload(ops, [FILE, FOLDER], "Personal", onError, onStarted);
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Downloading a folder as a zip needs a connection."),
    );
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe("selection bar with several items", () => {
  it("offers Download and downloads the selection as one zip named after the view", () => {
    const ops = operations();
    const selection = bar([FILE, FOLDER, OTHER], ops, { zipName: "Personal" });

    expect(selection.labels).toContain(driveLabels.selectionDownload);
    selection.click(driveLabels.selectionDownload);
    expect(ops.downloadSelection).toHaveBeenCalledWith(
      ["/users/alice/Notes.md", "/users/alice/Projects", "/users/alice/Plan.md"],
      "Personal",
    );
    expect(ops.downloadFile).not.toHaveBeenCalled();
    expect(ops.downloadFolder).not.toHaveBeenCalled();
  });

  it("downloads only the selected items, in selection order", () => {
    const ops = operations();
    bar([FILE, FOLDER, OTHER], ops, { zipName: "Recent", selectedIds: ["3", "1"] }).click(
      driveLabels.selectionDownload,
    );

    expect(ops.downloadSelection).toHaveBeenCalledWith(
      ["/users/alice/Plan.md", "/users/alice/Notes.md"],
      "Recent",
    );
  });

  it("names the zip Download when the view has no name", () => {
    const ops = operations();
    bar([FILE, FOLDER], ops, { zipName: "  " }).click(driveLabels.selectionDownload);
    bar([FILE, FOLDER], ops).click(driveLabels.selectionDownload);

    expect(ops.downloadSelection).toHaveBeenNthCalledWith(1, expect.any(Array), "Download");
    expect(ops.downloadSelection).toHaveBeenNthCalledWith(2, expect.any(Array), "Download");
  });

  it("offers no Download in trash or without selection zips (guests)", () => {
    expect(bar([FILE, FOLDER], operations(), { inTrashView: true }).labels).not.toContain(
      driveLabels.selectionDownload,
    );
    expect(bar([FILE, FOLDER], operations(false)).labels).not.toContain(
      driveLabels.selectionDownload,
    );
  });

  it("keeps the one-item Download unchanged", () => {
    const ops = operations();
    bar([FILE, FOLDER], ops, { selectedIds: ["2"] }).click(driveLabels.selectionDownload);

    expect(ops.downloadFolder).toHaveBeenCalledWith("/users/alice/Projects");
    expect(ops.downloadSelection).not.toHaveBeenCalled();
  });
});
