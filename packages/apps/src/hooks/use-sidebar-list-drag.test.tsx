import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarListDrag } from "./use-sidebar-list-drag";

function dragEvent(dropEffect = ""): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      effectAllowed: "",
      dropEffect,
      setData: vi.fn(),
    },
  } as unknown as React.DragEvent;
}

describe("useSidebarListDrag", () => {
  it("accepts a drop when canAccept is omitted or true", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSidebarListDrag(["card-a"]));

    act(() => {
      result.current.itemDragHandlers("card-a").onDragStart(dragEvent());
    });

    const allowed = dragEvent();
    act(() => {
      result.current.sidebarDropZoneProps("group:friends", onCommit).onDragOver(allowed);
    });
    expect(allowed.dataTransfer.dropEffect).toBe("move");
    expect(result.current.sidebarDropZoneProps("group:friends", onCommit).isDropTarget).toBe(true);

    act(() => {
      result.current.sidebarDropZoneProps("group:friends", onCommit).onDrop(dragEvent());
    });
    expect(onCommit).toHaveBeenCalledWith(["card-a"]);
  });

  it("shows a no-drop cursor and ignores commit when canAccept is false", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSidebarListDrag(["card-a"]));

    act(() => {
      result.current.itemDragHandlers("card-a").onDragStart(dragEvent());
    });

    const rejected = dragEvent();
    act(() => {
      result.current
        .sidebarDropZoneProps("group:admin", onCommit, () => false)
        .onDragOver(rejected);
    });
    expect(rejected.dataTransfer.dropEffect).toBe("none");
    expect(
      result.current.sidebarDropZoneProps("group:admin", onCommit, () => false).isDropTarget,
    ).toBe(false);

    act(() => {
      result.current.sidebarDropZoneProps("group:admin", onCommit, () => false).onDrop(dragEvent());
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
