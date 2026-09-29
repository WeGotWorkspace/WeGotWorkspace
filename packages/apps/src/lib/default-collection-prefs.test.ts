import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLLECTION_STORAGE_KEYS,
  parseDefaultCollectionPrefs,
  pickPreferredCollectionId,
  preferredCollectionName,
  readDefaultCollectionId,
  writeDefaultCollectionPrefs,
} from "@/lib/default-collection-prefs";

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
    writeDefaultCollectionPrefs("tasks", { collectionId: "work" });
    writeDefaultCollectionPrefs("contacts", { collectionId: "default" });
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
});
