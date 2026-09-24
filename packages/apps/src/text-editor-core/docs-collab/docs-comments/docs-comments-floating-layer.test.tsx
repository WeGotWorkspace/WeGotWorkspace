import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { TooltipProvider } from "@/ui/tooltip";
import type { DocsCommentThread } from "../docs-comments-types";
import { DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID } from "./docs-comments-mark-visibility";
import * as viewTimelinePolyfill from "./docs-comments-view-timeline-polyfill";
import { DocsCommentsFloatingLayer } from "./docs-comments-floating-layer";

import "./docs-comments-floating-layer.css";

function renderLayer(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

function mountEditor(content: string, options?: { withFormatBar?: boolean }) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark],
    content,
  });

  const editorRoot = document.createElement("div");
  editorRoot.className = "text-editor";

  if (options?.withFormatBar) {
    const formatBar = document.createElement("div");
    formatBar.className = "text-editor-format-bar";
    Object.defineProperty(formatBar, "getBoundingClientRect", {
      value: () => ({
        x: 120,
        y: 64,
        top: 64,
        left: 120,
        right: 720,
        bottom: 112,
        width: 600,
        height: 48,
        toJSON: () => ({}),
      }),
    });
    editorRoot.append(formatBar);
  }

  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet text-editor-sheet--fill";
  const surface = document.createElement("div");
  surface.className = "text-editor-sheet__surface";
  Object.defineProperty(surface, "getBoundingClientRect", {
    value: () => ({
      x: 120,
      y: 96,
      top: 96,
      left: 120,
      right: 720,
      bottom: 900,
      width: 600,
      height: 804,
      toJSON: () => ({}),
    }),
  });
  surface.append(editor.view.dom);
  sheet.append(surface);
  editorRoot.append(sheet);
  document.body.append(editorRoot);

  return editor;
}

const baseThread = (id: string, anchorFrom: number, anchorText: string): DocsCommentThread => ({
  id,
  anchorText,
  anchorFrom,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex" },
  resolved: false,
  messages: [
    {
      id: `${id}-m`,
      body: "Note",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
});

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

  vi.stubGlobal("CSS", {
    supports: () => true,
  });

  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn();
    root = null;
    rootMargin = "";
    thresholds = [];
    constructor(_callback: IntersectionObserverCallback) {}
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DocsCommentsFloatingLayer", () => {
  it("renders a stacked floating layer without absolute card tops", async () => {
    const editor = mountEditor(
      '<p><span data-comment-id="t-a" class="comment-mark">Alpha</span> <span data-comment-id="t-b" class="comment-mark">Beta</span></p>',
    );

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[baseThread("t-b", 20, "Beta"), baseThread("t-a", 8, "Alpha")]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    const layer = container.querySelector(".docs-comments-floating-layer") as HTMLElement;
    expect(layer).not.toBeNull();
    expect(layer.style.top).not.toBe("");
    expect(layer.style.left).not.toBe("");

    await waitFor(() => {
      expect(layer.dataset.visibilityMode).toBe("timeline");
    });

    const cards = Array.from(container.querySelectorAll(".docs-comments-floating-layer__card"));
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => !(card as HTMLElement).style.top)).toBe(true);

    const stack = container.querySelector(".docs-comments-floating-layer__stack");
    expect(stack).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll(".docs-comments-floating-layer__card")).map((card) =>
        card.querySelector("[data-thread-id]")?.getAttribute("data-thread-id"),
      ),
    ).toEqual(["t-a", "t-b"]);

    editor.destroy();
  });

  it("positions the floating layer at the sheet surface top", () => {
    const header = document.createElement("header");
    header.className = "workspace-app-layout__main-header";
    Object.defineProperty(header, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 64,
        width: 800,
        height: 64,
        toJSON: () => ({}),
      }),
    });
    document.body.prepend(header);

    const editor = mountEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
      { withFormatBar: true },
    );

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[baseThread("t-1", 8, "Hello")]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    const layer = container.querySelector(".docs-comments-floating-layer") as HTMLElement;
    expect(layer.style.top).toBe("96px");

    const firstCard = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(firstCard.style.top).toBe("");

    editor.destroy();
  });

  it("does not attach IntersectionObserver in timeline mode", async () => {
    const editor = mountEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );

    const observe = vi.fn();
    class MockIntersectionObserver {
      observe = observe;
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = "";
      thresholds = [];
      constructor(_callback: IntersectionObserverCallback) {}
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[baseThread("t-1", 8, "Hello")]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector(".docs-comments-floating-layer")
          ?.getAttribute("data-visibility-mode"),
      ).toBe("timeline");
    });
    expect(observe).not.toHaveBeenCalled();

    editor.destroy();
  });

  it("scopes view timelines on the scrollport and sets animation-timeline on cards via stylesheet", async () => {
    const editor = mountEditor(
      '<p><span data-comment-id="t-1" class="comment-mark">Hello</span></p>',
    );

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[baseThread("t-1", 8, "Hello")]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector(".docs-comments-floating-layer")
          ?.getAttribute("data-visibility-mode"),
      ).toBe("timeline");
    });

    const stylesheet =
      document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)?.textContent ?? "";
    expect(stylesheet).toContain(".text-editor-sheet--fill{timeline-scope:--docs-cmt-t-1;}");
    expect(stylesheet).toContain(
      '[data-comment-id="t-1"]{view-timeline-name:--docs-cmt-t-1;view-timeline-axis:block;}',
    );
    expect(stylesheet).toContain(
      '.docs-comments-floating-layer[data-visibility-mode="timeline"] .docs-comments-floating-layer__card[data-thread-id="t-1"]{animation-timeline:--docs-cmt-t-1;animation-range:entry 0% exit 100%;}',
    );

    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill") as HTMLElement;
    expect(scrollport.style.getPropertyValue("timeline-scope")).toBe("");

    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]') as HTMLElement;
    expect(mark.style.getPropertyValue("view-timeline-name")).toBe("");

    const card = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(card.getAttribute("data-thread-id")).toBe("t-1");
    expect(card.style.getPropertyValue("animation-timeline")).toBe("");
    expect(card.hasAttribute("data-in-view")).toBe(false);

    editor.destroy();
  });

  it("toggles card visibility via IntersectionObserver in observer fallback mode", async () => {
    vi.stubGlobal("CSS", { supports: () => false });
    vi.spyOn(viewTimelinePolyfill, "supportsCommentViewTimeline").mockReturnValue(false);
    vi.spyOn(viewTimelinePolyfill, "ensureCommentViewTimelinePolyfill").mockResolvedValue(false);

    const editor = mountEditor(
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

    const instances: Array<{ trigger: (isIntersecting: boolean) => void }> = [];

    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = "";
      thresholds = [];
      constructor(callback: IntersectionObserverCallback) {
        instances.push({
          trigger: (isIntersecting: boolean) => {
            callback(
              [
                {
                  target: mark,
                  isIntersecting,
                } as unknown as IntersectionObserverEntry,
              ],
              this as unknown as IntersectionObserver,
            );
          },
        });
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[baseThread("t-1", 8, "Hello")]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector(".docs-comments-floating-layer")
          ?.getAttribute("data-visibility-mode"),
      ).toBe("observer");
    });

    const card = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(card.getAttribute("data-in-view")).toBe("true");

    instances[0]?.trigger(false);
    expect(card.getAttribute("data-in-view")).toBe("false");

    instances[0]?.trigger(true);
    expect(card.getAttribute("data-in-view")).toBe("true");

    editor.destroy();
  });

  it("keeps draft compose cards visible in timeline mode without a comment mark", async () => {
    const editor = mountEditor("<p>Selected text for a new comment</p>");

    const draftThread: DocsCommentThread = {
      id: "draft-1",
      anchorText: "Selected",
      anchorFrom: 1,
      anchorTo: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [],
    };

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[]}
        draftThread={draftThread}
        currentUserId="u-1"
        activeThreadId="draft-1"
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector(".docs-comments-floating-layer")
          ?.getAttribute("data-visibility-mode"),
      ).toBe("timeline");
    });

    const card = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(card.getAttribute("data-draft")).toBe("true");
    expect(card.getAttribute("data-in-view")).toBe("true");

    editor.destroy();
  });

  it("renders draft compose when only the draft forces layer visibility", async () => {
    const editor = mountEditor("<p>Selected text for a new comment</p>");

    const draftThread: DocsCommentThread = {
      id: "draft-1",
      anchorText: "Selected",
      anchorFrom: 1,
      anchorTo: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [],
    };

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible={false}
        labels={docsLabels}
        threads={[]}
        draftThread={draftThread}
        currentUserId="u-1"
        activeThreadId="draft-1"
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".docs-comments-floating-layer")).not.toBeNull();
    });

    const card = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(card.getAttribute("data-draft")).toBe("true");
    expect(card.getAttribute("data-in-view")).toBe("true");

    editor.destroy();
  });

  it("keeps draft compose cards visible in static mode without a comment mark", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const editor = mountEditor("<p>Selected text for a new comment</p>");

    const draftThread: DocsCommentThread = {
      id: "draft-1",
      anchorText: "Selected",
      anchorFrom: 1,
      anchorTo: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [],
    };

    const { container } = renderLayer(
      <DocsCommentsFloatingLayer
        editor={editor}
        visible
        labels={docsLabels}
        threads={[]}
        draftThread={draftThread}
        currentUserId="u-1"
        activeThreadId="draft-1"
        onSelectThread={() => {}}
        onAddReply={() => {}}
        onToggleReaction={() => {}}
        onResolveThread={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector(".docs-comments-floating-layer")
          ?.getAttribute("data-visibility-mode"),
      ).toBe("static");
    });

    const card = container.querySelector(".docs-comments-floating-layer__card") as HTMLElement;
    expect(card.getAttribute("data-draft")).toBe("true");
    expect(card.getAttribute("data-in-view")).toBe("true");

    editor.destroy();
  });
});
