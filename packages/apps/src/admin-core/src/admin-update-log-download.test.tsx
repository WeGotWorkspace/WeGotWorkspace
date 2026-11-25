import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadPlainTextLines,
  openBlankWindow,
  showPlainTextLinesInWindow,
} from "@/admin-core/src/admin-update-log-download";

describe("downloadPlainTextLines", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads joined lines and revokes the object url", () => {
    const createObjectURL = vi.fn(() => "blob:update-log");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const anchor = document.createElement("a");
    const clickSpy = vi.spyOn(anchor, "click").mockImplementation(click);
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadPlainTextLines("update-log-test.log", ["one", "two"]);

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe("update-log-test.log");
    expect(anchor.href).toBe("blob:update-log");
    expect(clickSpy).toHaveBeenCalled();
    expect(document.body.contains(anchor)).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:update-log");
  });
});

describe("openBlankWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the window, without noopener, and clears its opener", () => {
    const fake = { opener: "parent" } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(fake);
    expect(openBlankWindow()).toBe(fake);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(fake.opener).toBeNull();
  });

  it("returns null when the browser blocks the window", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openBlankWindow()).toBeNull();
  });
});

describe("showPlainTextLinesInWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("points the window at a blob and revokes it later", () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:log", revokeObjectURL });
    const target = { location: { href: "" } } as unknown as Window;
    showPlainTextLinesInWindow(target, ["a"]);
    expect(target.location.href).toBe("blob:log");
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:log");
  });
});
