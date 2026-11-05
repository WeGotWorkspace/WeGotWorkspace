import { afterEach, describe, expect, it, vi } from "vitest";
import { publishElementHeight } from "@/lib/publish-element-height";

describe("publishElementHeight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets the height on the host and clears it on cleanup", () => {
    const host = document.createElement("div");
    const element = document.createElement("div");
    Object.defineProperty(element, "offsetHeight", { value: 64 });
    const cleanup = publishElementHeight(host, element, "--bar-height");
    expect(host.style.getPropertyValue("--bar-height")).toBe("64px");
    cleanup?.();
    expect(host.style.getPropertyValue("--bar-height")).toBe("");
  });

  it("follows resizes", () => {
    let notify = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const host = document.createElement("div");
    const element = document.createElement("div");
    let height = 40;
    Object.defineProperty(element, "offsetHeight", { get: () => height });
    const cleanup = publishElementHeight(host, element, "--bar-height");
    height = 72;
    notify();
    expect(host.style.getPropertyValue("--bar-height")).toBe("72px");
    cleanup?.();
    expect(disconnect).toHaveBeenCalled();
  });

  it("does nothing without both elements", () => {
    expect(publishElementHeight(null, document.createElement("div"), "--x")).toBeUndefined();
  });
});
