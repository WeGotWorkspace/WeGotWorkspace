import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveUIData } from "@/drive-core/src/drive-types";
import { useDriveMutations } from "./use-drive-mutations";
import { buildList, buildShell } from "./use-drive-mutations-fixtures";

const memberData = createDriveAppBootstrap().data;
const guestData: DriveUIData = {
  ...memberData,
  user: { ...memberData.user, role: "guest" as DriveUIData["user"]["role"] },
};

function renderMutations(data: DriveUIData) {
  const shell = buildShell({ data });
  const list = buildList({ selectedIds: ["f-1"] });
  const hook = renderHook(() => useDriveMutations({ shell, list }));
  return { ...hook, shell, list };
}

function sampleFile(): DriveFile {
  return buildShell().files[0]!;
}

function dragStartEvent() {
  return { preventDefault: vi.fn(), dataTransfer: null } as unknown as DragEvent;
}

describe("useDriveMutations for a guest (no write path yet, #1712)", () => {
  it("reports structure editing as unavailable", () => {
    const { result } = renderMutations(guestData);
    expect(result.current.structureEnabled).toBe(false);
  });

  it("does not open the new folder, rename, move or delete dialogs", () => {
    const { result } = renderMutations(guestData);

    act(() => {
      result.current.createFolder();
      result.current.requestRenameItem(sampleFile());
      result.current.requestMoveItem(sampleFile());
      result.current.requestMoveSelected();
      result.current.requestDeleteItem(sampleFile());
      result.current.requestDeleteSelected();
    });

    expect(result.current.newFolderDialogOpen).toBe(false);
    expect(result.current.renameDialog).toBeNull();
    expect(result.current.moveDialog).toBeNull();
    expect(result.current.confirmDelete).toBeNull();
  });

  it("ignores the delete keyboard shortcut", () => {
    const { result } = renderMutations(guestData);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    });

    expect(result.current.confirmDelete).toBeNull();
  });

  it("cancels drag-to-move and never moves on drop", () => {
    const { result, list, shell } = renderMutations(guestData);
    const event = dragStartEvent();

    result.current.itemDragHandlers("f-1").onDragStart(event);
    act(() => {
      result.current.commitMoveToFolder(["f-1"], "My Drive/Archive");
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(list.itemDragHandlers).not.toHaveBeenCalled();
    expect(list.queueMutation).not.toHaveBeenCalled();
    expect(shell.operations?.renameItem).not.toHaveBeenCalled();
  });
});

describe("useDriveMutations for a signed-in member", () => {
  it("keeps structure editing, the delete shortcut and drag-to-move", () => {
    const { result, list } = renderMutations(memberData);
    const event = dragStartEvent();

    expect(result.current.structureEnabled).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    });
    expect(result.current.confirmDelete).toEqual({ ids: ["f-1"], permanent: false });

    result.current.itemDragHandlers("f-1").onDragStart(event);
    expect(list.itemDragHandlers).toHaveBeenCalledWith("f-1");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
