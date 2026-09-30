/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COLLECTION_STORAGE_KEYS,
  parseDefaultCollectionPrefs,
  pickPreferredCollectionId,
  preferredCollectionName,
  readDefaultCollectionId,
  useDefaultCollectionId,
  writeDefaultCollectionPrefs,
} from "@/lib/default-collection-prefs";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";

describe("default-collection-prefs", () => {
  it("parses a trimmed collection id and ignores blanks", () => {
    expect(parseDefaultCollectionPrefs(JSON.stringify({ collectionId: "work" }))).toEqual({
      collectionId: "work",
    });
    expect(parseDefaultCollectionPrefs(JSON.stringify({ collectionId: "  " }))).toEqual({});
    expect(parseDefaultCollectionPrefs("not-json")).toEqual({});
  });

  it("writes and reads per-app keys without touching other apps", () => {
    window.localStorage.clear();
    expect(writeDefaultCollectionPrefs("tasks", { collectionId: "work" })).toBe(true);
    expect(writeDefaultCollectionPrefs("contacts", { collectionId: "default" })).toBe(true);
    expect(readDefaultCollectionId("tasks")).toBe("work");
    expect(readDefaultCollectionId("contacts")).toBe("default");
    expect(readDefaultCollectionId("notes")).toBeUndefined();
    expect(window.localStorage.getItem(DEFAULT_COLLECTION_STORAGE_KEYS.notes)).toBeNull();
    writeDefaultCollectionPrefs("tasks", {});
    expect(readDefaultCollectionId("tasks")).toBeUndefined();
  });

  it("picks a preferred id only when it is in the writable set", () => {
    expect(pickPreferredCollectionId(["inbox", "work"], "work")).toBe("work");
    expect(pickPreferredCollectionId(["inbox", "work"], "missing")).toBeUndefined();
    expect(pickPreferredCollectionId(["inbox"], undefined)).toBeUndefined();
  });

  it("returns a stored notebook name only when it is still in the personal set", () => {
    window.localStorage.clear();
    writeDefaultCollectionPrefs("notes", { collectionId: "The Journal" });
    expect(preferredCollectionName("notes", ["The Journal", "Drafts"])).toBe("The Journal");
    expect(preferredCollectionName("notes", ["Drafts"])).toBeUndefined();
    writeDefaultCollectionPrefs("notes", {});
    expect(preferredCollectionName("notes", ["The Journal", "Drafts"])).toBeUndefined();
  });

  it("refreshes useDefaultCollectionId after notifySettingsSliceSaved", () => {
    window.localStorage.clear();
    const { result } = renderHook(() => useDefaultCollectionId("tasks"));
    expect(result.current).toBeUndefined();
    writeDefaultCollectionPrefs("tasks", { collectionId: "work" });
    act(() => {
      notifySettingsSliceSaved({ panelId: "contacts", sliceId: "contacts-default-collection" });
    });
    expect(result.current).toBeUndefined();
    act(() => {
      notifySettingsSliceSaved({ panelId: "tasks", sliceId: "tasks-default-collection" });
    });
    expect(result.current).toBe("work");
  });

  it("refreshes useDefaultCollectionId after a storage event for the tasks key", () => {
    window.localStorage.clear();
    const { result } = renderHook(() => useDefaultCollectionId("tasks"));
    expect(result.current).toBeUndefined();
    window.localStorage.setItem(
      DEFAULT_COLLECTION_STORAGE_KEYS.tasks,
      JSON.stringify({ collectionId: "inbox" }),
    );
    act(() => {
      const storageEvent = new Event("storage");
      Object.defineProperty(storageEvent, "key", {
        value: DEFAULT_COLLECTION_STORAGE_KEYS.tasks,
      });
      window.dispatchEvent(storageEvent);
    });
    expect(result.current).toBe("inbox");
  });

  it("returns false when localStorage.setItem throws", () => {
    window.localStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(writeDefaultCollectionPrefs("tasks", { collectionId: "work" })).toBe(false);
    setItem.mockRestore();
  });
});
