import { act, renderHook } from "@testing-library/react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it } from "vitest";
import { useListKeyboardNavigation } from "./use-list-keyboard-navigation";
import { useSelectableListState } from "./use-selectable-list-state";

const IDS = ["a", "b", "c", "d", "e"];

function useHarness(initialActive: string) {
  const [activeId, setActiveId] = useState(initialActive);
  const [selectedIds, setSelectedIds] = useState<string[]>([initialActive]);
  const [selectionMode, setSelectionMode] = useState(false);
  const { navigateListByKeyboard } = useListKeyboardNavigation({
    visibleIds: IDS,
    activeId,
    selectedIds,
    setActiveId,
    setSelectionMode,
    setSelectedIds,
  });
  return { activeId, selectedIds, selectionMode, navigateListByKeyboard };
}

describe("useListKeyboardNavigation", () => {
  it("extends the selection with Shift+Arrow from the anchor", () => {
    const { result } = renderHook(() => useHarness("c"));
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.navigateListByKeyboard(1, true));
    expect(result.current.selectedIds).toEqual(["c", "d", "e"]);
    expect(result.current.activeId).toBe("e");
    expect(result.current.selectionMode).toBe(true);
  });

  it("shrinks back toward the anchor and crosses it", () => {
    const { result } = renderHook(() => useHarness("c"));
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.navigateListByKeyboard(-1, true));
    expect(result.current.selectedIds).toEqual(["c"]);
    act(() => result.current.navigateListByKeyboard(-1, true));
    act(() => result.current.navigateListByKeyboard(-1, true));
    expect(result.current.selectedIds).toEqual(["a", "b", "c"]);
    expect(result.current.activeId).toBe("a");
  });

  it("stops at the list edges", () => {
    const { result } = renderHook(() => useHarness("d"));
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.navigateListByKeyboard(1, true));
    expect(result.current.selectedIds).toEqual(["d", "e"]);
  });

  it("a plain arrow collapses to one item and drops the anchor", () => {
    const { result } = renderHook(() => useHarness("b"));
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.navigateListByKeyboard(1, false));
    expect(result.current.selectedIds).toEqual(["d"]);
    expect(result.current.selectionMode).toBe(false);
    act(() => result.current.navigateListByKeyboard(-1, true));
    expect(result.current.selectedIds).toEqual(["c", "d"]);
  });
});

function click(overrides: Partial<ReactMouseEvent> = {}): ReactMouseEvent {
  return {
    detail: 1,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  } as ReactMouseEvent;
}

/** Mouse and keys together, wired as `useWorkspaceListController` does. */
function useMouseAndKeysHarness() {
  const [activeId, setActiveId] = useState("");
  const selection = useSelectableListState({ visibleIds: IDS, onPrimarySelect: setActiveId });
  const { navigateListByKeyboard } = useListKeyboardNavigation({
    visibleIds: IDS,
    activeId,
    selectedIds: selection.selectedIds,
    setActiveId,
    setSelectionMode: selection.setSelectionMode,
    setSelectedIds: selection.setSelectedIds,
    rangeAnchorId: selection.selectionAnchorId,
    rangeEndId: selection.selectionEndId,
    onRangeChange: selection.setSelectionRange,
  });
  return { activeId, selection, navigateListByKeyboard };
}

describe("useListKeyboardNavigation after mouse selection", () => {
  it("Shift+Down after a shift-click range grows it from the clicked end", () => {
    const { result } = renderHook(() => useMouseAndKeysHarness());
    act(() => result.current.selection.handleSelect("a", click()));
    act(() => result.current.selection.handleSelect("d", click({ shiftKey: true })));
    expect(result.current.selection.selectedIds).toEqual(["a", "b", "c", "d"]);
    act(() => result.current.navigateListByKeyboard(1, true));
    expect(result.current.selection.selectedIds).toEqual(["a", "b", "c", "d", "e"]);
    act(() => result.current.navigateListByKeyboard(-1, true));
    act(() => result.current.navigateListByKeyboard(-1, true));
    expect(result.current.selection.selectedIds).toEqual(["a", "b", "c"]);
  });

  it("Shift+Up after an upward shift-click range grows it upward", () => {
    const { result } = renderHook(() => useMouseAndKeysHarness());
    act(() => result.current.selection.handleSelect("e", click()));
    act(() => result.current.selection.handleSelect("b", click({ shiftKey: true })));
    expect(result.current.selection.selectedIds).toEqual(["b", "c", "d", "e"]);
    act(() => result.current.navigateListByKeyboard(-1, true));
    expect(result.current.selection.selectedIds).toEqual(["a", "b", "c", "d", "e"]);
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.navigateListByKeyboard(1, true));
    expect(result.current.selection.selectedIds).toEqual(["c", "d", "e"]);
  });

  it("Shift+Down after Cmd-click grows from the Cmd-clicked row and keeps the others", () => {
    const { result } = renderHook(() => useMouseAndKeysHarness());
    act(() => result.current.selection.handleSelect("a", click()));
    act(() => result.current.selection.handleSelect("c", click({ metaKey: true })));
    expect(result.current.selection.selectedIds).toEqual(["a", "c"]);
    act(() => result.current.navigateListByKeyboard(1, true));
    expect(result.current.selection.selectedIds).toEqual(["a", "c", "d"]);
    expect(result.current.activeId).toBe("d");
  });

  it("a shift-click after plain arrows starts at the row the arrows reached", () => {
    const { result } = renderHook(() => useMouseAndKeysHarness());
    act(() => result.current.selection.handleSelect("a", click()));
    act(() => result.current.navigateListByKeyboard(1, false));
    act(() => result.current.navigateListByKeyboard(1, false));
    expect(result.current.activeId).toBe("c");
    act(() => result.current.selection.handleSelect("e", click({ shiftKey: true })));
    expect(result.current.selection.selectedIds).toEqual(["c", "d", "e"]);
  });

  it("a shift-click after Shift+Arrow keeps the keyboard's anchor", () => {
    const { result } = renderHook(() => useMouseAndKeysHarness());
    act(() => result.current.selection.handleSelect("b", click()));
    act(() => result.current.navigateListByKeyboard(1, true));
    act(() => result.current.selection.handleSelect("e", click({ shiftKey: true })));
    expect(result.current.selection.selectedIds).toEqual(["b", "c", "d", "e"]);
  });
});
