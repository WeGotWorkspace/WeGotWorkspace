import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTouchResizeHandleActive, shouldMountResizeHandles } from "./ResizeHandle.js";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ResizeHandle.css"), "utf8");

describe("isTouchResizeHandleActive", () => {
  it("is true only when the event key matches the selection", () => {
    expect(isTouchResizeHandleActive("evt-1", "evt-1")).toBe(true);
    expect(isTouchResizeHandleActive("evt-1", "evt-2")).toBe(false);
    expect(isTouchResizeHandleActive("evt-1", "")).toBe(false);
    expect(isTouchResizeHandleActive(undefined, "evt-1")).toBe(false);
  });
});

describe("shouldMountResizeHandles", () => {
  const base = {
    resizeHandlesEnabled: true,
    eventKey: "dentist",
    selectedEventKey: "",
    eventIndex: 3,
    hoveredEventIndex: -1,
    resizingEventIndex: -1,
  };

  it("stays off for idle unselected cards", () => {
    expect(shouldMountResizeHandles(base)).toBe(false);
  });

  it("mounts for the selected event", () => {
    expect(shouldMountResizeHandles({ ...base, selectedEventKey: "dentist" })).toBe(true);
  });

  it("mounts for the hovered event", () => {
    expect(shouldMountResizeHandles({ ...base, hoveredEventIndex: 3 })).toBe(true);
  });

  it("mounts for the event currently being resized", () => {
    expect(shouldMountResizeHandles({ ...base, resizingEventIndex: 3 })).toBe(true);
  });

  it("stays off when the timeline disables handles", () => {
    expect(
      shouldMountResizeHandles({
        ...base,
        resizeHandlesEnabled: false,
        selectedEventKey: "dentist",
        hoveredEventIndex: 3,
        resizingEventIndex: 3,
      }),
    ).toBe(false);
  });
});

describe("ResizeHandle coarse-pointer contract", () => {
  it("hides unselected handles on coarse pointers (scroll/swipe/move keep working)", () => {
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)/);
    expect(css).toMatch(/display:\s*none/);
    expect(css).toMatch(/pointer-events:\s*none/);
  });

  it("shows a larger hit target after select with a thin event-accent pill", () => {
    expect(css).toContain(":host([active])");
    expect(css).toContain("@apply h-6");
    expect(css).toContain("@apply w-6");
    expect(css).toContain("--_lc-resize-handle-thickness: 3px");
    expect(css).toContain("--_lc-event-accent-color");
    expect(css).not.toContain("CanvasText");
    expect(css).not.toContain("--_lc-event-text-color");
    expect(css).not.toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{\s*:host \{\s*display: none;\s*pointer-events: none;\s*\}\s*\}/,
    );
  });

  it("reveals the pill on event hover via an inherited opacity token", () => {
    expect(css).toContain("--_lc-resize-handle-event-hover");
  });

  it("uses one visual inset on touch and fine pointer (touch hit stays larger)", () => {
    expect(css).toContain("--_lc-resize-handle-inset: 6px");
    expect(css).toContain("padding-block-start: var(--_lc-resize-handle-inset)");
    expect(css).toContain("padding-block-end: var(--_lc-resize-handle-inset)");
    expect(css).toContain("padding-inline-start: var(--_lc-resize-handle-inset)");
    expect(css).toContain("padding-inline-end: var(--_lc-resize-handle-inset)");
    expect(css).toContain("@apply w-full h-3");
    expect(css).toContain("@apply h-full w-3");
    expect(css).not.toMatch(/:host\(\[active\]\)[\s\S]*--_lc-resize-handle-inset:/);
  });
});
