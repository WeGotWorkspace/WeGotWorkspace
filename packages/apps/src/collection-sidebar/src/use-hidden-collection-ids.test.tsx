import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";

const STORAGE_KEY = "wgw.ui.test.hiddenCollectionIds";

function readPersist() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { hiddenIds?: string[]; knownIds?: string[] };
  return {
    hiddenIds: record.hiddenIds,
    knownIds: record.knownIds,
  };
}

function writePersist(hiddenIds: ReadonlySet<string>, itemIds: ReadonlyArray<string>) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ hiddenIds: [...hiddenIds], knownIds: [...itemIds] }),
  );
}

const persist = { read: readPersist, write: writePersist };

const loadedItems = [{ id: "drafts" }, { id: "work" }, { id: "shared", isVisible: false }];

describe("useHiddenCollectionIds", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("does not wipe persisted hides when the first paint has no collections", () => {
    writePersist(new Set(["work"]), ["drafts", "work", "shared"]);

    const empty = renderHook(({ items }) => useHiddenCollectionIds(items, persist), {
      initialProps: { items: [] as typeof loadedItems },
    });
    expect(empty.result.current.hiddenIds.has("work")).toBe(true);
    expect(readPersist()?.hiddenIds).toEqual(["work"]);

    empty.rerender({ items: loadedItems });
    expect(empty.result.current.hiddenIds.has("work")).toBe(true);
    expect(readPersist()?.hiddenIds).toEqual(["work"]);
    empty.unmount();

    const remount = renderHook(() => useHiddenCollectionIds(loadedItems, persist));
    expect(remount.result.current.hiddenIds.has("work")).toBe(true);
  });

  it("keeps a user hide after remount once collections are loaded", () => {
    const first = renderHook(() => useHiddenCollectionIds(loadedItems, persist));
    act(() => {
      first.result.current.setHiddenIds(new Set(["work"]));
    });
    expect(first.result.current.hiddenIds.has("work")).toBe(true);
    first.unmount();

    const second = renderHook(() => useHiddenCollectionIds(loadedItems, persist));
    expect(second.result.current.hiddenIds.has("work")).toBe(true);
    expect(second.result.current.hiddenIds.has("shared")).toBe(false);
  });
});
