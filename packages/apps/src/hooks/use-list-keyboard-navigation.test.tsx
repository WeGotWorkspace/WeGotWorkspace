import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useListKeyboardNavigation } from "./use-list-keyboard-navigation";

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
