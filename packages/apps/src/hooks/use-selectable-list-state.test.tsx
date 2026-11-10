import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY } from "@/workspace-app/src/collection-detail-breakpoint";
import { useSelectableListState } from "./use-selectable-list-state";

function mouseEvent(overrides: Partial<ReactMouseEvent> = {}): ReactMouseEvent {
  return {
    detail: 1,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  } as ReactMouseEvent;
}

describe("useSelectableListState", () => {
  it("keeps active in sync when cmd-click collapses multi-select to one other id", () => {
    const onPrimarySelect = vi.fn();
    const { result } = renderHook(() =>
      useSelectableListState({
        visibleIds: ["a", "b", "c"],
        onPrimarySelect,
      }),
    );

    act(() => {
      result.current.handleSelect("a", mouseEvent());
    });
    expect(onPrimarySelect).toHaveBeenLastCalledWith("a");
    expect(result.current.selectedIds).toEqual(["a"]);

    act(() => {
      result.current.handleSelect("b", mouseEvent({ metaKey: true }));
    });
    expect(result.current.selectedIds).toEqual(["a", "b"]);
    expect(onPrimarySelect).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleSelect("a", mouseEvent({ metaKey: true }));
    });
    expect(result.current.selectedIds).toEqual(["b"]);
    expect(onPrimarySelect).toHaveBeenLastCalledWith("b");
  });

  it("does not clear the primary when cmd-click deselects the only selected id", () => {
    const onPrimarySelect = vi.fn();
    const { result } = renderHook(() =>
      useSelectableListState({
        initialId: "a",
        visibleIds: ["a", "b"],
        onPrimarySelect,
      }),
    );

    act(() => {
      result.current.handleSelect("a", mouseEvent({ metaKey: true }));
    });
    expect(result.current.selectedIds).toEqual([]);
    expect(onPrimarySelect).not.toHaveBeenCalled();
  });

  it("opens the primary row synchronously on the mobile overlay viewport", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === COLLECTION_DETAIL_OVERLAY_MEDIA_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const onPrimarySelect = vi.fn();
    const { result } = renderHook(() =>
      useSelectableListState({
        visibleIds: ["a", "b"],
        onPrimarySelect,
      }),
    );

    act(() => {
      result.current.handleSelect("a", mouseEvent());
      expect(onPrimarySelect).toHaveBeenCalledWith("a");
    });
  });
  it("adds a shift-click range to rows picked before in selection mode", () => {
    const { result } = renderHook(() =>
      useSelectableListState({ visibleIds: ["a", "b", "c", "d", "e"] }),
    );

    act(() => result.current.enterSelectionFor("a"));
    act(() => result.current.handleSelect("c", mouseEvent()));
    act(() => result.current.handleSelect("e", mouseEvent({ shiftKey: true })));

    expect([...result.current.selectedIds].sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("lets a shorter shift-click range replace the longer one in selection mode", () => {
    const { result } = renderHook(() =>
      useSelectableListState({ visibleIds: ["a", "b", "c", "d", "e", "f"] }),
    );

    act(() => result.current.enterSelectionFor("a"));
    act(() => result.current.handleSelect("c", mouseEvent()));
    act(() => result.current.handleSelect("f", mouseEvent({ shiftKey: true })));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "c", "d", "e", "f"]);

    act(() => result.current.handleSelect("d", mouseEvent({ shiftKey: true })));
    expect([...result.current.selectedIds].sort()).toEqual(["a", "c", "d"]);
  });
});
