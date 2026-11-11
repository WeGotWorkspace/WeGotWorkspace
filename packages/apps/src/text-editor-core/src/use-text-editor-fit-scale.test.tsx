/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextEditorFitScale } from "@/text-editor-core/src/use-text-editor-fit-scale";

/** A sheet 400px wide holding a 794px (A4) page column. */
function mountSheet() {
  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet";
  const surface = document.createElement("div");
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  surface.appendChild(dom);
  sheet.appendChild(surface);
  document.body.appendChild(sheet);
  Object.defineProperty(sheet, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(dom, "offsetWidth", { configurable: true, value: 794 });
  Object.defineProperty(dom, "offsetHeight", { configurable: true, value: 1123 });
  const editor = { view: { dom } } as unknown as Editor;
  return { editor, dom, surface };
}

describe("useTextEditorFitScale", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shrinks a page wider than its sheet", () => {
    const { editor, dom, surface } = mountSheet();
    renderHook(() => useTextEditorFitScale(editor, true));

    expect(dom.style.transform).toMatch(/^scale\(0\.\d+\)$/);
    expect(Number.parseFloat(surface.style.width)).toBeLessThan(400);
  });

  it("prints at full size and fits again after printing", () => {
    const { editor, dom, surface } = mountSheet();
    renderHook(() => useTextEditorFitScale(editor, true));
    const fitted = dom.style.transform;

    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(dom.style.transform).toBe("");
    expect(surface.style.width).toBe("");

    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(dom.style.transform).toBe(fitted);
  });

  it("leaves the page alone when off", () => {
    const { editor, dom } = mountSheet();
    renderHook(() => useTextEditorFitScale(editor, false));
    expect(dom.style.transform).toBe("");
  });
});
