/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  printTextEditorSheet,
  PRINT_IMAGE_WAIT_MS,
  TEXT_EDITOR_PRINT_FORMATTED_CLASS,
  waitForSheetImages,
} from "./text-editor-print";

function createMockEditor(editorRoot: HTMLElement, proseMirror?: HTMLElement): Editor {
  const dom = proseMirror ?? editorRoot.querySelector(".ProseMirror") ?? editorRoot;
  return {
    view: {
      dom,
    },
  } as Editor;
}

function buildEditorDom(options?: { viewSource?: boolean; hideFormatted?: boolean }) {
  const source = document.createElement("div");
  source.className = "text-editor__source text-editor-source";
  source.textContent = "# Markdown source";

  const formatted = document.createElement("div");
  formatted.className = "text-editor__formatted";
  if (options?.hideFormatted) {
    formatted.style.display = "none";
  }

  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet text-editor-sheet--fill";
  const surface = document.createElement("div");
  surface.className = "text-editor-sheet__surface";
  const prose = document.createElement("div");
  prose.className = "ProseMirror text-editor-prose";
  prose.textContent = "Formatted document body";
  surface.appendChild(prose);
  sheet.appendChild(surface);
  formatted.appendChild(sheet);

  const body = document.createElement("div");
  body.className = "text-editor__body";
  body.appendChild(source);
  body.appendChild(formatted);

  const editorRoot = document.createElement("div");
  editorRoot.className = cn("text-editor", options?.viewSource && "text-editor--view-source");
  editorRoot.appendChild(body);
  document.body.appendChild(editorRoot);

  return { editorRoot, surface, source, formatted, prose };
}

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

describe("printTextEditorSheet", () => {
  // Printing waits for images and two frames, so it finishes later. Fake timers and
  // instant frames keep each test's print inside that test; `afterEach` runs what is left.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "print").mockImplementation(() => {});
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.classList.remove("text-editor-print-active");
    document.documentElement.style.removeProperty("--text-editor-print-page-margin");
    document.documentElement.style.removeProperty("--text-editor-print-prose-font-size");
    document.body.classList.remove("text-editor-print-active");
    document
      .querySelectorAll(`.${TEXT_EDITOR_PRINT_FORMATTED_CLASS}`)
      .forEach((node) => node.classList.remove(TEXT_EDITOR_PRINT_FORMATTED_CLASS));
  });

  it("activates print classes and mirrors margin tokens", () => {
    const surface = document.createElement("div");
    surface.className = "text-editor-sheet__surface";
    const editorRoot = document.createElement("div");
    editorRoot.className = "text-editor";
    editorRoot.appendChild(surface);
    document.body.appendChild(editorRoot);

    printTextEditorSheet(createMockEditor(editorRoot));

    expect(document.documentElement.classList.contains("text-editor-print-active")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--text-editor-print-page-margin")).toBe(
      "0.75in",
    );
    expect(
      document.documentElement.style.getPropertyValue("--text-editor-print-prose-font-size"),
    ).toBe("16px");

    editorRoot.remove();
  });

  it("prints the formatted sheet in view-source split layout", () => {
    const { editorRoot, surface, source, prose } = buildEditorDom({ viewSource: true });

    printTextEditorSheet(createMockEditor(editorRoot, prose));

    expect(surface.classList.contains("text-editor-sheet__surface--print")).toBe(true);
    expect(editorRoot.classList.contains(TEXT_EDITOR_PRINT_FORMATTED_CLASS)).toBe(true);
    expect(source.classList.contains("text-editor-sheet__surface--print")).toBe(false);

    editorRoot.remove();
  });

  it("finds the formatted sheet when the formatted pane is display:none (portrait source view)", () => {
    const { editorRoot, surface, prose } = buildEditorDom({
      viewSource: true,
      hideFormatted: true,
    });

    printTextEditorSheet(createMockEditor(editorRoot, prose));

    expect(surface.classList.contains("text-editor-sheet__surface--print")).toBe(true);
    expect(editorRoot.classList.contains(TEXT_EDITOR_PRINT_FORMATTED_CLASS)).toBe(true);

    editorRoot.remove();
  });

  it("prints in the light theme and puts dark mode back afterwards", () => {
    document.documentElement.dataset.theme = "dark";
    const { editorRoot, prose } = buildEditorDom();
    try {
      printTextEditorSheet(createMockEditor(editorRoot, prose));
      // Paper is white: dark mode's light text would print grey.
      expect(document.documentElement.dataset.theme).toBe("light");
      window.dispatchEvent(new Event("afterprint"));
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      delete document.documentElement.dataset.theme;
      editorRoot.remove();
    }
  });

  it("waits for a Drive image that is still loading before printing", async () => {
    const { editorRoot, prose } = buildEditorDom();
    const img = document.createElement("img");
    img.dataset.loading = "true";
    prose.appendChild(img);

    printTextEditorSheet(createMockEditor(editorRoot, prose));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(window.print).not.toHaveBeenCalled();

    delete img.dataset.loading;
    await vi.advanceTimersByTimeAsync(200);
    expect(window.print).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("afterprint"));
    editorRoot.remove();
  });

  it("does not print and restores the page when the editor unmounts while an image loads", async () => {
    document.documentElement.dataset.theme = "dark";
    const { editorRoot, prose } = buildEditorDom();
    const img = document.createElement("img");
    img.dataset.loading = "true";
    prose.appendChild(img);

    try {
      printTextEditorSheet(createMockEditor(editorRoot, prose));
      expect(document.documentElement.dataset.theme).toBe("light");

      editorRoot.remove();
      await vi.advanceTimersByTimeAsync(200);

      expect(window.print).not.toHaveBeenCalled();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.body.classList.contains("text-editor-print-active")).toBe(false);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
});

describe("waitForSheetImages", () => {
  it("gives up after the wait limit, so a failed image never blocks printing", async () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement("div");
      const img = document.createElement("img");
      img.dataset.loading = "true";
      surface.appendChild(img);
      let done = false;
      void waitForSheetImages(surface).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(PRINT_IMAGE_WAIT_MS - 500);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for an image without a source that is not loading (blocked or failed)", async () => {
    const surface = document.createElement("div");
    surface.appendChild(document.createElement("img"));
    await expect(waitForSheetImages(surface, 10)).resolves.toBeUndefined();
  });
});
