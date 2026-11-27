/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCS_FORMAT_BAR_PLACEMENT_KEY,
  readDocsFormatBarPlacement,
  subscribeDocsFormatBarPlacement,
  writeDocsFormatBarPlacement,
} from "./docs-format-bar-placement";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Docs format bar placement", () => {
  it("starts on top", () => {
    expect(readDocsFormatBarPlacement()).toBe("top");
  });

  it("keeps the choice on this device and tells listeners", () => {
    const listener = vi.fn();
    const stop = subscribeDocsFormatBarPlacement(listener);
    expect(writeDocsFormatBarPlacement("selection")).toBe(true);
    expect(window.localStorage.getItem(DOCS_FORMAT_BAR_PLACEMENT_KEY)).toBe("selection");
    expect(readDocsFormatBarPlacement()).toBe("selection");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores a value it does not know", () => {
    window.localStorage.setItem(DOCS_FORMAT_BAR_PLACEMENT_KEY, "bottom");
    expect(readDocsFormatBarPlacement()).toBe("top");
  });

  it("follows the choice in this tab when storage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(writeDocsFormatBarPlacement("selection")).toBe(false);
    expect(readDocsFormatBarPlacement()).toBe("selection");
  });
});
