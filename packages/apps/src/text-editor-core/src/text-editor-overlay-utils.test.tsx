import { describe, expect, it, vi } from "vitest";
import {
  canElementAbsorbVerticalWheel,
  forwardOverlayWheelToEditorScroll,
} from "./text-editor-overlay-utils";

describe("canElementAbsorbVerticalWheel", () => {
  it("returns false when the element is not scrollable", () => {
    const element = {
      scrollHeight: 100,
      clientHeight: 100,
      scrollTop: 0,
    } as HTMLElement;

    expect(canElementAbsorbVerticalWheel(element, 10)).toBe(false);
  });

  it("returns true when scrolling down inside a scrollable element", () => {
    const element = {
      scrollHeight: 300,
      clientHeight: 100,
      scrollTop: 0,
    } as HTMLElement;

    expect(canElementAbsorbVerticalWheel(element, 10)).toBe(true);
  });
});

describe("forwardOverlayWheelToEditorScroll", () => {
  it("forwards wheel events on comment cards to the editor scroller", () => {
    const scroller = document.createElement("div");
    scroller.className = "text-editor-sheet--fill";
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollTop", { writable: true, value: 0 });

    const editorAnchor = document.createElement("div");
    scroller.append(editorAnchor);

    const overlayRoot = document.createElement("div");
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    overlayRoot.append(card);

    const event = {
      target: card,
      deltaY: 48,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    // Computed style (overflow-y) only applies to connected elements.
    document.body.append(scroller);
    try {
      expect(forwardOverlayWheelToEditorScroll(event, editorAnchor, overlayRoot)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(48);
    } finally {
      scroller.remove();
    }
  });
});
