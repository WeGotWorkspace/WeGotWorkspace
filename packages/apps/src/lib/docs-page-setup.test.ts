/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCS_PAGE_SETUP_STORAGE_KEY,
  parseDocsPageSetupPrefs,
  readDocsPageSetupPrefs,
  resolveDocsPageSetup,
  subscribeDocsPageSetup,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";

afterEach(() => {
  writeDocsPageSetupPrefs({}); // a saved write drops any unsaved in-memory choice
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
