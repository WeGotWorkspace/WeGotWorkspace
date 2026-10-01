import { describe, expect, it, vi } from "vitest";
import {
  createListSelectionStore,
  listItemHighlightKey,
} from "@/list-item/src/list-item-selection-store";

describe("listItemHighlightKey", () => {
  it("encodes active and selected per id, ignoring selection mode", () => {
    const state = { activeId: "b", selectedIds: ["a", "b"], selectionMode: true };
    expect(listItemHighlightKey(state, "a")).toBe("01");
    expect(listItemHighlightKey(state, "b")).toBe("11");
    expect(listItemHighlightKey(state, "c")).toBe("00");
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
    expect(store.getVersion()).toBe(1);
    expect(store.highlightKey("a")).toBe("11");
    expect(store.setState({ activeId: "a", selectedIds: ["a"], selectionMode: false })).toBe(false);
    expect(store.getVersion()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.setState({ activeId: "b", selectedIds: ["b"], selectionMode: false })).toBe(true);
    expect(store.getVersion()).toBe(2);
    store.notify();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.highlightKey("a")).toBe("00");
    expect(store.highlightKey("b")).toBe("11");
  });
});
