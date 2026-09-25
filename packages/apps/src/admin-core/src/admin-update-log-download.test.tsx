import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPlainTextLines } from "@/admin-core/src/admin-update-log-download";

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
