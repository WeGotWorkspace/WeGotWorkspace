import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as Y from "yjs";
import {
  LOCAL_EDIT_PREVIEW_DEBOUNCE_MS,
  LOCAL_EDIT_PREVIEW_MAX_WAIT_MS,
  useNoteBodyPreviewSync,
} from "@/note-detail-view/src/use-note-body-preview-sync";

vi.mock("@/text-editor-core/docs-collab/docs-collab-editor-surface", () => ({
  readContentFromYDoc: vi.fn(() => "body from the doc"),
}));

function setup() {
  const ydoc = new Y.Doc();
  const listener = vi.fn();
  let text = "";
  const getMarkdown = vi.fn(() => text);
  const hook = renderHook(() => useNoteBodyPreviewSync(ydoc, listener));
  const type = (next: string) => {
    text = next;
    act(() => hook.result.current.noteLocalEdit(getMarkdown));
  };
  return { ydoc, listener, getMarkdown, hook, type };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNoteBodyPreviewSync (#1714)", () => {
  it("reports a burst of keystrokes once, after a pause, without reading markdown per key", () => {
    const { listener, getMarkdown, type } = setup();

    for (const text of ["a", "ab", "abc", "abcd"]) {
      type(text);
      act(() => vi.advanceTimersByTime(100));
    }
    expect(getMarkdown).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(LOCAL_EDIT_PREVIEW_DEBOUNCE_MS));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("abcd", "local-edit");
    expect(getMarkdown).toHaveBeenCalledTimes(1);
  });

  it("still reports while typing without a pause", () => {
    const { listener, type } = setup();
    const keys = Math.ceil(LOCAL_EDIT_PREVIEW_MAX_WAIT_MS / 100) + 2;

    for (let index = 1; index <= keys; index += 1) {
      type("x".repeat(index));
      act(() => vi.advanceTimersByTime(100));
    }

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1]).toBe("local-edit");
  });

  it("reports the last edit when the session unmounts mid-pause", () => {
    const { listener, hook, type } = setup();
    type("last words");

    hook.unmount();

    expect(listener).toHaveBeenCalledWith("last words", "local-edit");
  });

  it("reads the body from the Y.Doc when the editor is gone on unmount", () => {
    const { listener, hook, type, getMarkdown } = setup();
    type("last words");
    getMarkdown.mockImplementation(() => {
      throw new Error("view destroyed");
    });

    hook.unmount();

    expect(listener).toHaveBeenCalledWith("body from the doc", "local-edit");
  });

  it("reports the last edit when the page hides mid-pause", () => {
    const { listener, type } = setup();
    type("closing the tab");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(listener).toHaveBeenCalledWith("closing the tab", "local-edit");
  });

  it("does not turn Yjs updates from local typing into a hydrate report", () => {
    const { ydoc, listener, type } = setup();
    type("typed");
    act(() => {
      ydoc.getText("t").insert(0, "x");
      vi.advanceTimersByTime(100);
    });
    expect(listener).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(LOCAL_EDIT_PREVIEW_DEBOUNCE_MS));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("typed", "local-edit");
  });

  it("reports remote updates as hydrate when nothing local is pending", () => {
    const { ydoc, listener, hook } = setup();
    act(() => hook.result.current.registerMarkdownGetter(() => "loaded"));
    expect(listener).toHaveBeenLastCalledWith("loaded", "hydrate");

    act(() => hook.result.current.registerMarkdownGetter(() => "from a peer"));
    act(() => {
      ydoc.getText("t").insert(0, "x");
      vi.advanceTimersByTime(100);
    });
    expect(listener).toHaveBeenLastCalledWith("from a peer", "hydrate");
  });
});
