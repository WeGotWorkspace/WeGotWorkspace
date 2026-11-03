/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCS_PAGE_SETUP_MAX_OVERRIDES,
  DOCS_PAGE_SETUP_OVERRIDES_KEY,
  DOCS_PAGE_SETUP_STORAGE_KEY,
  moveDocsPageSetupOverride,
  parseDocsPageSetupOverrides,
  readDocsPageSetupOverrides,
  resolveDocPageSetup,
  startDocWithDefaultPageSetup,
  writeDocsPageSetupOverride,
  parseDocsPageSetupPrefs,
  readDocsPageSetupPrefs,
  resolveDocsPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";

afterEach(() => {
  // A saved write drops any unsaved in-memory value.
  writeDocsPageSetupPrefs({});
  writeDocsPageSetupOverride("/x", { format: "a4", orientation: "portrait" }, 0);
  window.localStorage.clear();
});

describe("parseDocsPageSetupPrefs", () => {
  it("keeps known values", () => {
    expect(parseDocsPageSetupPrefs('{"format":"a3","orientation":"landscape"}')).toEqual({
      format: "a3",
      orientation: "landscape",
    });
    expect(parseDocsPageSetupPrefs('{"format":"none"}')).toEqual({ format: "none" });
  });

  it("reads the old Continuous switch as no paper", () => {
    expect(
      parseDocsPageSetupPrefs('{"format":"a3","orientation":"landscape","layout":"continuous"}'),
    ).toEqual({ format: "none", orientation: "landscape" });
    expect(parseDocsPageSetupPrefs('{"format":"a3","layout":"pages"}')).toEqual({
      format: "a3",
    });
  });

  it("drops unknown values and survives bad JSON", () => {
    expect(parseDocsPageSetupPrefs('{"format":"b5","orientation":"portrait"}')).toEqual({
      orientation: "portrait",
    });
    expect(parseDocsPageSetupPrefs("{not json")).toEqual({});
    expect(parseDocsPageSetupPrefs("[1,2]")).toEqual({});
    expect(parseDocsPageSetupPrefs(null)).toEqual({});
  });
});

describe("resolveDocsPageSetup", () => {
  it("defaults to pages, portrait and the locale paper size", () => {
    expect(resolveDocsPageSetup({}, ["en-US"])).toEqual({
      format: "letter",
      orientation: "portrait",
      layout: "pages",
    });
    expect(resolveDocsPageSetup({}, ["nl-NL"]).format).toBe("a4");
  });

  it("keeps the person's choices over the defaults", () => {
    expect(resolveDocsPageSetup({ format: "legal", orientation: "landscape" }, ["en-US"])).toEqual({
      format: "legal",
      orientation: "landscape",
      layout: "pages",
    });
  });

  it("shows no pages when the paper is none", () => {
    expect(resolveDocsPageSetup({ format: "none" }, ["nl-NL"])).toEqual({
      format: "none",
      orientation: "portrait",
      layout: "continuous",
    });
  });
});

describe("writeDocsPageSetupPrefs", () => {
  it("merges into what is stored and tells open editors", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocsPageSetup(listener);
    expect(writeDocsPageSetupPrefs({ format: "a5" })).toBe(true);
    expect(writeDocsPageSetupPrefs({ orientation: "landscape" })).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(DOCS_PAGE_SETUP_STORAGE_KEY) ?? "")).toEqual({
      format: "a5",
      orientation: "landscape",
    });
    expect(readDocsPageSetupPrefs()).toEqual({ format: "a5", orientation: "landscape" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("drops the old layout key on the next write", () => {
    window.localStorage.setItem(
      DOCS_PAGE_SETUP_STORAGE_KEY,
      JSON.stringify({ format: "a4", layout: "continuous" }),
    );
    writeDocsPageSetupPrefs({ format: "a5" });
    expect(JSON.parse(window.localStorage.getItem(DOCS_PAGE_SETUP_STORAGE_KEY) ?? "")).toEqual({
      format: "a5",
    });
  });

  it("follows a change from another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocsPageSetup(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: DOCS_PAGE_SETUP_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "wgw.ui.other" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("still tells open editors when storage rejects the write", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocsPageSetup(listener);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeDocsPageSetupPrefs({ format: "none" })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    unsubscribe();
  });

  it("keeps a rejected choice in this tab until a saved write or another tab's change", () => {
    window.localStorage.setItem(DOCS_PAGE_SETUP_STORAGE_KEY, JSON.stringify({ format: "a4" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    writeDocsPageSetupPrefs({ format: "a5" });
    writeDocsPageSetupPrefs({ orientation: "landscape" });
    setItem.mockRestore();
    expect(readDocsPageSetupPrefs()).toEqual({ format: "a5", orientation: "landscape" });
    expect(window.localStorage.getItem(DOCS_PAGE_SETUP_STORAGE_KEY)).toBe('{"format":"a4"}');

    const unsubscribe = subscribeDocsPageSetup(() => {});
    window.localStorage.setItem(DOCS_PAGE_SETUP_STORAGE_KEY, JSON.stringify({ format: "legal" }));
    window.dispatchEvent(new StorageEvent("storage", { key: DOCS_PAGE_SETUP_STORAGE_KEY }));
    expect(readDocsPageSetupPrefs()).toEqual({ format: "legal" });
    unsubscribe();
  });
});

describe("per-document page setup", () => {
  it("parses entries with both choices and drops the rest", () => {
    expect(
      parseDocsPageSetupOverrides(
        JSON.stringify({
          "/a.md": { format: "legal", orientation: "landscape", at: 5 },
          "/b.md": { format: "b5", orientation: "portrait" },
          "/c.md": { format: "a4" },
          "/d.md": { format: "none", orientation: "portrait" },
          "/e.md": "a4",
        }),
      ),
    ).toEqual({
      "/a.md": { format: "legal", orientation: "landscape", at: 5 },
      "/d.md": { format: "none", orientation: "portrait", at: 0 },
    });
    expect(parseDocsPageSetupOverrides("{not json")).toEqual({});
  });

  it("uses a document's own choice, else the default", () => {
    const overrides = {
      "/users/ann/plan.md": { format: "legal", orientation: "landscape", at: 1 },
    } as const;
    expect(
      resolveDocPageSetup("users/ann/plan.md", { format: "a5" }, overrides, ["nl-NL"]),
    ).toEqual({
      format: "legal",
      orientation: "landscape",
      layout: "pages",
    });
    expect(
      resolveDocPageSetup("/users/ann/other.md", { format: "a5" }, overrides, ["nl-NL"]),
    ).toEqual({
      format: "a5",
      orientation: "portrait",
      layout: "pages",
    });
    expect(resolveDocPageSetup(null, {}, overrides, ["en-US"]).format).toBe("letter");
  });

  it("changing one document leaves the default and other documents alone", () => {
    writeDocsPageSetupPrefs({ format: "a4" });
    writeDocsPageSetupOverride("/plan.md", { format: "legal", orientation: "landscape" }, 10);
    expect(readDocsPageSetupPrefs()).toEqual({ format: "a4" });
    expect(readDocsPageSetupOverrides()).toEqual({
      "/plan.md": { format: "legal", orientation: "landscape", at: 10 },
    });
  });

  it("a new document starts with the default and keeps it when the default changes", () => {
    writeDocsPageSetupPrefs({ format: "a5", orientation: "landscape" });
    startDocWithDefaultPageSetup("/new.md");
    writeDocsPageSetupPrefs({ format: "letter", orientation: "portrait" });
    expect(
      resolveDocPageSetup("/new.md", readDocsPageSetupPrefs(), readDocsPageSetupOverrides()),
    ).toMatchObject({ format: "a5", orientation: "landscape" });
  });

  it("a renamed document keeps its page setup", () => {
    writeDocsPageSetupOverride("/old.md", { format: "a3", orientation: "portrait" }, 3);
    expect(moveDocsPageSetupOverride("/old.md", "/new.md")).toBe(true);
    expect(readDocsPageSetupOverrides()).toEqual({
      "/new.md": { format: "a3", orientation: "portrait", at: 3 },
    });
    expect(moveDocsPageSetupOverride("/missing.md", "/other.md")).toBe(false);
  });

  it("documents under a renamed folder keep their page setup", () => {
    writeDocsPageSetupOverride(
      "/users/a/Notes/plan.md",
      { format: "a3", orientation: "portrait" },
      3,
    );
    writeDocsPageSetupOverride(
      "/users/a/Notes2/x.md",
      { format: "a4", orientation: "portrait" },
      4,
    );
    expect(moveDocsPageSetupOverride("/users/a/Notes", "/users/a/Archive")).toBe(true);
    expect(readDocsPageSetupOverrides()).toEqual({
      "/users/a/Archive/plan.md": { format: "a3", orientation: "portrait", at: 3 },
      "/users/a/Notes2/x.md": { format: "a4", orientation: "portrait", at: 4 },
    });
    expect(moveDocsPageSetupOverride("/users/a/Notes", "/users/a/Archive")).toBe(false);
  });

  it("keeps the most recently changed documents only", () => {
    const many = Object.fromEntries(
      Array.from({ length: DOCS_PAGE_SETUP_MAX_OVERRIDES }, (_, i) => [
        `/doc-${i}.md`,
        { format: "a4", orientation: "portrait", at: i + 1 },
      ]),
    );
    window.localStorage.setItem(DOCS_PAGE_SETUP_OVERRIDES_KEY, JSON.stringify(many));
    writeDocsPageSetupOverride("/latest.md", { format: "a5", orientation: "portrait" }, 10_000);
    const kept = readDocsPageSetupOverrides();
    expect(Object.keys(kept)).toHaveLength(DOCS_PAGE_SETUP_MAX_OVERRIDES);
    expect(kept["/latest.md"]).toBeDefined();
    expect(kept["/doc-0.md"]).toBeUndefined();
  });

  it("follows another tab's change to a document", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocsPageSetup(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: DOCS_PAGE_SETUP_OVERRIDES_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
