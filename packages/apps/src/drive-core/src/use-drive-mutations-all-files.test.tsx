import type { ReactElement } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { driveLabels } from "./drive-labels";
import type { DriveFile } from "./drive-models";
import { useDriveMutations } from "./use-drive-mutations";
import { buildList, buildShell } from "./use-drive-mutations-fixtures";
import type { DriveShellState } from "./use-drive-shell";

// All Files rows come from every drive, so they are not in the open folder's
// `files`: move, drag and Download must find them through `fileById`.

const OPEN_FOLDER_ROW = buildShell().files[0]!;

const ALL_FILES_ROW: DriveFile = {
  ...OPEN_FOLDER_ROW,
  id: "g-1",
  title: "brief.md",
  parent: "Design",
  apiPath: "/groups/Design/brief.md",
};

function renderAllFilesMutations(selectedIds: string[] = []) {
  const downloadFile = vi.fn(async () => undefined);
  const base = buildShell();
  const shell = buildShell({
    labels: driveLabels,
    view: { type: "all" },
    operations: { ...base.operations, downloadFile } as DriveShellState["operations"],
  });
  const list = buildList({
    selectedIds,
    selectionMode: selectedIds.length > 0,
    beginOptimisticUpdate: vi.fn(() => ({
      snapshotById: new Map<string, DriveFile>(),
      affectedItems: [],
      rollback: vi.fn(),
    })),
    fileById: (id: string) => [OPEN_FOLDER_ROW, ALL_FILES_ROW].find((row) => row.id === id) ?? null,
  });
  const { result } = renderHook(() => useDriveMutations({ shell, list }));
  return { result, list, downloadFile };
}

describe("useDriveMutations with All Files rows", () => {
  it("moves a row from another drive to a folder", () => {
    const { result, list } = renderAllFilesMutations();

    act(() => result.current.commitMoveToFolder(["g-1"], "My Drive/Plans"));

    expect(list.queueMutation).toHaveBeenCalledTimes(1);
  });

  it("does not move a row into the folder it is already in", () => {
    const { result, list } = renderAllFilesMutations();

    act(() => result.current.commitMoveToFolder(["g-1"], "Design"));

    expect(list.queueMutation).not.toHaveBeenCalled();
  });

  it("hands the move dialog the rows it moves", () => {
    const { result } = renderAllFilesMutations();

    act(() => result.current.requestMoveItem(ALL_FILES_ROW));

    expect(result.current.moveDialog).toEqual({ ids: ["g-1"], rows: [ALL_FILES_ROW] });
  });

  it("offers Download for a selected row from another drive", () => {
    const { result, downloadFile } = renderAllFilesMutations(["g-1"]);
    const bar = result.current.selectionBar as ReactElement<{
      buttons: { label: string; onClick?: () => void }[];
    }>;

    const download = bar.props.buttons.find(
      (button) => button.label === driveLabels.selectionDownload,
    );
    download?.onClick?.();

    expect(download).toBeDefined();
    expect(downloadFile).toHaveBeenCalled();
  });
});
