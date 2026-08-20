import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTouchResizeHandleActive } from "./ResizeHandle.js";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ResizeHandle.css"), "utf8");

describe("isTouchResizeHandleActive", () => {
  it("is true only when the event key matches the selection", () => {
    expect(isTouchResizeHandleActive("evt-1", "evt-1")).toBe(true);
    expect(isTouchResizeHandleActive("evt-1", "evt-2")).toBe(false);
    expect(isTouchResizeHandleActive("evt-1", "")).toBe(false);
    expect(isTouchResizeHandleActive(undefined, "evt-1")).toBe(false);
  });
});

describe("ResizeHandle coarse-pointer contract", () => {
  it("hides unselected handles on coarse pointers (scroll/swipe/move keep working)", () => {
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)/);
    expect(css).toMatch(/display:\s*none/);
    expect(css).toMatch(/pointer-events:\s*none/);
  });

  it("shows a 24px grabber after select instead of un-hiding the 2px hover bar", () => {
    expect(css).toContain(":host([active])");
    expect(css).toContain("@apply h-6");
    expect(css).toContain("@apply w-6");
    expect(css).toContain("--_lc-resize-handle-thickness: 6px");
    expect(css).toContain("--_lc-resize-handle-color: var(--_lc-event-text-color, CanvasText)");
    expect(css).not.toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*:host \{\s*display: none;\s*pointer-events: none;\s*\}\s*\}/,
    );
  });
});
