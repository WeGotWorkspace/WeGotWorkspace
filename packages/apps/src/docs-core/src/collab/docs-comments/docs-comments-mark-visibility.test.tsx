import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";
import * as viewTimelinePolyfill from "./docs-comments-view-timeline-polyfill";
import {
  buildCollabTimelineScope,
  buildCollabTimelineStylesheet,
  buildCommentTimelineScope,
  buildCommentViewTimelineStylesheet,
  collabMarkIds,
  commentViewTimelineName,
  DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID,
  failOpenBrokenTimelineCards,
  isCommentMarkInScrollport,
  observeCommentMarkVisibility,
  resolveCommentVisibilityMode,
  resolveCommentVisibilityModeAsync,
  sortThreadsByDocumentOrder,
  suggestionViewTimelineName,
  syncCollabCardScrollLinkedState,
  syncCommentViewTimelineStyles,
  syncCommentMarkVisibility,
} from "./docs-comments-mark-visibility";

function createEditor(content = "<p>Hello world</p>") {
  const editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark],
    content,
  });

  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet text-editor-sheet--fill";
  const surface = document.createElement("div");
  surface.className = "text-editor-sheet__surface";
  surface.append(editor.view.dom);
  sheet.append(surface);
  document.body.append(sheet);

  return editor;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function viewTimelineStylesheetText(): string {
  return document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)?.textContent ?? "";
}

describe("commentViewTimelineName", () => {
  it("builds a stable timeline name from thread ids", () => {
    expect(commentViewTimelineName("t-1")).toBe("--docs-cmt-t-1");
    expect(commentViewTimelineName("weird/id+1")).toBe("--docs-cmt-weird_id_1");
  });
});

describe("suggestionViewTimelineName", () => {
  it("builds a stable timeline name from change ids", () => {
    expect(suggestionViewTimelineName("s-1")).toBe("--docs-sug-s-1");
    expect(suggestionViewTimelineName("weird/id+1")).toBe("--docs-sug-weird_id_1");
  });
});

describe("buildCommentTimelineScope", () => {
  it("joins timeline names for timeline-scope", () => {
    expect(buildCommentTimelineScope(["a", "b"])).toBe("--docs-cmt-a, --docs-cmt-b");
  });
});

describe("buildCollabTimelineScope", () => {
  it("joins comment and suggestion timeline names for timeline-scope", () => {
    expect(buildCollabTimelineScope(["a"], ["s-1"])).toBe("--docs-cmt-a, --docs-sug-s-1");
  });
});

describe("sortThreadsByDocumentOrder", () => {
  it("orders threads by anchorFrom", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-b" class="comment-mark">B</span> <span data-comment-id="t-a" class="comment-mark">A</span></p>',
    );

    const threads: DocsCommentThread[] = [
      {
        id: "t-a",
        anchorText: "A",
        anchorFrom: 20,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: "m-1",
            body: "A",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      },
      {
        id: "t-b",
        anchorText: "B",
        anchorFrom: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: "m-2",
            body: "B",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      },
    ];

    const ordered = sortThreadsByDocumentOrder(editor, threads);
    expect(ordered.map((thread) => thread.id)).toEqual(["t-b", "t-a"]);
    editor.destroy();
  });
});

describe("buildCollabTimelineStylesheet", () => {
  it("builds comment and suggestion rules from a unified mark-id map", () => {
    const css = buildCollabTimelineStylesheet(collabMarkIds(["t-1"], ["s-1"]));
    expect(css).toContain(
      '[data-comment-id="t-1"]{view-timeline-name:--docs-cmt-t-1;view-timeline-axis:block;}',
    );
    expect(css).toContain(
      '[data-change-id="s-1"]{view-timeline-name:--docs-sug-s-1;view-timeline-axis:block;}',
    );
    expect(css).toContain(
      ".text-editor-sheet--fill{timeline-scope:--docs-cmt-t-1, --docs-sug-s-1;}",
    );
  });
});

describe("buildCommentViewTimelineStylesheet", () => {
  it("builds mark, scope, and card animation-timeline rules", () => {
    const css = buildCommentViewTimelineStylesheet(["t-1", "t-2"]);
    expect(css).toContain(
      '[data-comment-id="t-1"]{view-timeline-name:--docs-cmt-t-1;view-timeline-axis:block;}',
    );
    expect(css).toContain(
      ".text-editor-sheet--fill{timeline-scope:--docs-cmt-t-1, --docs-cmt-t-2;}",
    );
    expect(css).toContain(
      '.docs-comments-floating-layer[data-visibility-mode="timeline"] .docs-comments-floating-layer__card[data-thread-id="t-1"]{animation-timeline:--docs-cmt-t-1;animation-range:entry 0% exit 100%;}',
    );
  });

  it("builds suggestion mark rules without floating card selectors", () => {
    const css = buildCommentViewTimelineStylesheet([], ["s-1"]);
    expect(css).toContain(
      '[data-change-id="s-1"]{view-timeline-name:--docs-sug-s-1;view-timeline-axis:block;}',
    );
    expect(css).toContain(".text-editor-sheet--fill{timeline-scope:--docs-sug-s-1;}");
    expect(css).not.toContain("docs-collab-review-floating-layer");
  });
});

describe("syncCommentViewTimelineStyles", () => {
  it("assigns view-timeline names to open marks via injected stylesheet", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );

    syncCommentViewTimelineStyles(editor, ["t-1"]);

    const stylesheet = viewTimelineStylesheetText();
    expect(stylesheet).toContain(
      '[data-comment-id="t-1"]{view-timeline-name:--docs-cmt-t-1;view-timeline-axis:block;}',
    );
    expect(
      (
        editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement
      ).style.getPropertyValue("view-timeline-name"),
    ).toBe("");
    editor.destroy();
  });

  it("assigns timeline-scope on the scrollport for open threads via stylesheet", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );

    syncCommentViewTimelineStyles(editor, ["t-1", "t-2"]);

    expect(viewTimelineStylesheetText()).toContain(
      ".text-editor-sheet--fill{timeline-scope:--docs-cmt-t-1, --docs-cmt-t-2;}",
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    expect(scrollport.style.getPropertyValue("timeline-scope")).toBe("");
    editor.destroy();
  });

  it("clears timeline stylesheet when no threads are displayed", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );

    syncCommentViewTimelineStyles(editor, ["t-1"]);
    syncCommentViewTimelineStyles(editor, []);

    expect(document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)).toBeNull();
    editor.destroy();
  });
});

describe("isCommentMarkInScrollport", () => {
  it("returns false when the mark is outside the scrollport bounds", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 920,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 900,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    expect(isCommentMarkInScrollport(mark, scrollport)).toBe(false);
    editor.destroy();
  });

  it("returns true when the mark intersects the scrollport bounds", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    expect(isCommentMarkInScrollport(mark, scrollport)).toBe(true);
    editor.destroy();
  });
});

describe("syncCommentMarkVisibility", () => {
  it("sets data-in-view from mark geometry for static mode", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 920,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 900,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    syncCommentMarkVisibility(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-in-view")).toBe("false");
    editor.destroy();
  });

  it("sets data-in-view on suggestion cards from change mark geometry", () => {
    const editor = createEditor("<p>Hello</p>");
    const mark = document.createElement("span");
    mark.setAttribute("data-change-id", "s-1");
    mark.textContent = "Hello";
    editor.view.dom.querySelector("p")!.append(mark);

    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    syncCommentMarkVisibility(editor, () => card, [], ["s-1"]);
    expect(card.getAttribute("data-in-view")).toBe("true");
    editor.destroy();
  });
});

describe("observeCommentMarkVisibility", () => {
  it("syncs initial in-view state from mark geometry before observer callbacks", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 920,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 900,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(_callback: IntersectionObserverCallback) {}
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const observer = observeCommentMarkVisibility(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-in-view")).toBe("false");

    observer.disconnect();
  });

  it("updates cards from IntersectionObserver callbacks", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    const instances: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      trigger: (isIntersecting: boolean) => void;
    }> = [];

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(private callback: IntersectionObserverCallback) {
        instances.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: (isIntersecting: boolean) => {
            this.callback(
              [
                {
                  target: editor.view.dom.querySelector('[data-comment-id="t-1"]')!,
                  isIntersecting,
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            );
          },
        });
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    expect(card.getAttribute("data-in-view")).toBeNull();

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const observer = observeCommentMarkVisibility(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-in-view")).toBe("true");
    expect(instances[0]?.observe).toHaveBeenCalledTimes(1);

    instances[0]?.trigger(false);
    expect(card.getAttribute("data-in-view")).toBe("false");

    observer.disconnect();
  });

  it("resync re-evaluates mark visibility after editor updates", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    const markRect = vi.spyOn(mark, "getBoundingClientRect");
    const scrollportRect = vi.spyOn(scrollport, "getBoundingClientRect");

    markRect.mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    scrollportRect.mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(_callback: IntersectionObserverCallback) {}
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const observer = observeCommentMarkVisibility(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-in-view")).toBe("true");

    markRect.mockReturnValue({
      top: 900,
      bottom: 920,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 900,
      toJSON: () => ({}),
    });
    observer.resync();
    expect(card.getAttribute("data-in-view")).toBe("false");

    observer.disconnect();
  });

  it("updates suggestion cards from IntersectionObserver callbacks", () => {
    const editor = createEditor("<p>Hello</p>");
    const mark = document.createElement("span");
    mark.setAttribute("data-change-id", "s-1");
    mark.textContent = "Hello";
    editor.view.dom.querySelector("p")!.append(mark);

    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    const instances: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      trigger: (isIntersecting: boolean) => void;
    }> = [];

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(private callback: IntersectionObserverCallback) {
        instances.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: (isIntersecting: boolean) => {
            this.callback(
              [
                {
                  target: editor.view.dom.querySelector('[data-change-id="s-1"]')!,
                  isIntersecting,
                } as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            );
          },
        });
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const observer = observeCommentMarkVisibility(editor, () => card, [], ["s-1"]);
    expect(card.getAttribute("data-in-view")).toBe("true");

    instances[0]?.trigger(false);
    expect(card.getAttribute("data-in-view")).toBe("false");

    observer.disconnect();
  });
});

describe("syncCollabCardScrollLinkedState", () => {
  it("marks suggestion cards scroll-linked when their change mark exists", () => {
    const editor = createEditor("<p>Hello</p>");
    const mark = document.createElement("ins");
    mark.setAttribute("data-change-id", "s-1");
    mark.textContent = "!";
    editor.view.dom.querySelector("p")!.append(mark);

    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    syncCollabCardScrollLinkedState(editor, () => card, [], ["s-1"]);
    expect(card.getAttribute("data-scroll-linked")).toBe("true");

    editor.destroy();
  });

  it("marks cards scroll-linked when their document mark exists", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    syncCollabCardScrollLinkedState(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-scroll-linked")).toBe("true");

    editor.destroy();
  });

  it("marks cards as not scroll-linked when the document mark is missing", () => {
    const editor = createEditor("<p>Hello</p>");
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    document.body.append(card);

    syncCollabCardScrollLinkedState(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-scroll-linked")).toBe("false");

    editor.destroy();
  });

  it("keeps timeline fallback cards scroll-unlinked after resync", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    card.setAttribute("data-timeline-fallback", "true");
    card.setAttribute("data-scroll-linked", "false");
    card.setAttribute("data-in-view", "true");
    document.body.append(card);

    syncCollabCardScrollLinkedState(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-scroll-linked")).toBe("false");
    expect(card.getAttribute("data-timeline-fallback")).toBe("true");

    editor.destroy();
  });
});

describe("failOpenBrokenTimelineCards", () => {
  it("falls back to geometry visibility when scroll-linked cards stay hidden in view", () => {
    const editor = createEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );
    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    const card = document.createElement("div");
    card.className = "docs-comments-floating-layer__card";
    card.setAttribute("data-scroll-linked", "true");
    document.body.append(card);

    vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 120,
      left: 10,
      right: 40,
      width: 30,
      height: 20,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      opacity: "0",
    } as CSSStyleDeclaration);

    failOpenBrokenTimelineCards(editor, () => card, ["t-1"]);
    expect(card.getAttribute("data-scroll-linked")).toBe("false");
    expect(card.getAttribute("data-timeline-fallback")).toBe("true");
    expect(card.getAttribute("data-in-view")).toBe("true");

    editor.destroy();
  });
});

describe("resolveCommentVisibilityMode", () => {
  it("prefers timeline mode when view-timeline is supported", () => {
    vi.stubGlobal("CSS", {
      supports: (prop: string, val: string) => prop === "animation-timeline" && val === "view()",
    });
    expect(resolveCommentVisibilityMode()).toBe("timeline");
  });

  it("falls back to observer mode when view-timeline is unsupported", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(resolveCommentVisibilityMode()).toBe("observer");
  });

  it("prefers static mode when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    expect(resolveCommentVisibilityMode()).toBe("static");
  });
});

describe("resolveCommentVisibilityModeAsync", () => {
  it("uses timeline mode after the polyfill loads", async () => {
    vi.spyOn(viewTimelinePolyfill, "supportsCommentViewTimeline").mockReturnValue(false);
    vi.spyOn(viewTimelinePolyfill, "ensureCommentViewTimelinePolyfill").mockResolvedValue(true);

    await expect(resolveCommentVisibilityModeAsync()).resolves.toBe("timeline");
  });

  it("falls back to observer mode when polyfill load fails", async () => {
    vi.spyOn(viewTimelinePolyfill, "supportsCommentViewTimeline").mockReturnValue(false);
    vi.spyOn(viewTimelinePolyfill, "ensureCommentViewTimelinePolyfill").mockResolvedValue(false);

    await expect(resolveCommentVisibilityModeAsync()).resolves.toBe("observer");
  });
});
