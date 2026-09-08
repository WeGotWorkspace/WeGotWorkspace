/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  focusTextEditorFromChromeEvent,
  shouldFocusTextEditorFromChromeTarget,
} from "./text-editor-chrome-focus";

function createEditor(options?: { editable?: boolean; prose?: HTMLElement }) {
  const prose = options?.prose ?? document.createElement("div");
  prose.className = "ProseMirror";
  const focus = vi.fn().mockReturnValue(true);
  const editor = {
    isEditable: options?.editable ?? true,
    view: { dom: prose },
    commands: { focus },
  } as unknown as Editor;
  return { editor, prose, focus };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shouldFocusTextEditorFromChromeTarget", () => {
  it("returns true for empty chrome around the editor", () => {
    const chrome = document.createElement("div");
    const { editor, prose } = createEditor();
    chrome.append(prose);
    document.body.append(chrome);

    expect(shouldFocusTextEditorFromChromeTarget(chrome, editor)).toBe(true);
    chrome.remove();
  });

  it("returns false when the target is already inside ProseMirror", () => {
    const { editor, prose } = createEditor();
    const paragraph = document.createElement("p");
    prose.append(paragraph);
    document.body.append(prose);

    expect(shouldFocusTextEditorFromChromeTarget(paragraph, editor)).toBe(false);
    expect(shouldFocusTextEditorFromChromeTarget(prose, editor)).toBe(false);
    prose.remove();
  });

  it("returns false for send, format-bar, and mention controls", () => {
    const chrome = document.createElement("div");
    const { editor, prose } = createEditor();
    const send = document.createElement("button");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    chrome.append(prose, send, option, listbox);
    document.body.append(chrome);

    expect(shouldFocusTextEditorFromChromeTarget(send, editor)).toBe(false);
    expect(shouldFocusTextEditorFromChromeTarget(option, editor)).toBe(false);
    expect(shouldFocusTextEditorFromChromeTarget(listbox, editor)).toBe(false);
    chrome.remove();
  });

  it("returns false when the editor is not editable", () => {
    const chrome = document.createElement("div");
    const { editor } = createEditor({ editable: false });
    expect(shouldFocusTextEditorFromChromeTarget(chrome, editor)).toBe(false);
  });
});

describe("focusTextEditorFromChromeEvent", () => {
  it("focuses the editor at end for chrome clicks", () => {
    const chrome = document.createElement("div");
    const { editor, prose, focus } = createEditor();
    chrome.append(prose);
    document.body.append(chrome);
    const preventDefault = vi.fn();

    expect(focusTextEditorFromChromeEvent({ target: chrome, preventDefault }, editor)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith("end", { scrollIntoView: false });
    chrome.remove();
  });

  it("does not focus when the click is on an interactive control", () => {
    const { editor, focus } = createEditor();
    const send = document.createElement("button");
    const preventDefault = vi.fn();

    expect(focusTextEditorFromChromeEvent({ target: send, preventDefault }, editor)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
