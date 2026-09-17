import { describe, expect, it, vi } from "vitest";
import {
  createListSelectionStore,
  listItemHighlightKey,
} from "@/list-item/src/list-item-selection-store";

describe("listItemHighlightKey", () => {
  it("encodes active, selected, and selection mode per id", () => {
    const state = { activeId: "b", selectedIds: ["a", "b"], selectionMode: true };
    expect(listItemHighlightKey(state, "a")).toBe("011");
    expect(listItemHighlightKey(state, "b")).toBe("111");
    expect(listItemHighlightKey(state, "c")).toBe("001");
  });
});

describe("createListSelectionStore", () => {
  it("notifies listeners only when the snapshot changes", () => {
    const store = createListSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.setState({ activeId: "a", selectedIds: ["a"], selectionMode: false })).toBe(true);
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.highlightKey("a")).toBe("110");
    expect(store.setState({ activeId: "a", selectedIds: ["a"], selectionMode: false })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.setState({ activeId: "b", selectedIds: ["b"], selectionMode: false })).toBe(true);
    store.notify();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.highlightKey("a")).toBe("000");
    expect(store.highlightKey("b")).toBe("110");
  });
});
