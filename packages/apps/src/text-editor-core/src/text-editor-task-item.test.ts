/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { revealTaskItemCheckboxBox } from "./text-editor-task-item";

function mountEditor(content = "- [ ] Unchecked item\n- [x] Checked item"): Editor {
  const editor = new Editor({
    extensions: createTextEditorExtensions({ format: "markdown" }),
    content,
  });
  document.body.append(editor.view.dom);
  return editor;
}

function checkboxBoxes(editor: Editor): HTMLInputElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

function visualBox(input: HTMLInputElement): HTMLElement | null {
  const span = input.nextElementSibling;
  return span instanceof HTMLElement ? span : null;
}

describe("text editor task-item checkbox box", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("unwraps TipTap's visually-hidden span so the tokenized box can paint", () => {
    const hidden = document.createElement("li");
    hidden.innerHTML =
      '<label><input type="checkbox"><span style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Task item checkbox for empty task item</span></label>';
    revealTaskItemCheckboxBox(hidden);
    const span = hidden.querySelector("span");
    expect(span?.getAttribute("style")).toBeNull();
    expect(span?.textContent).toBe("");
    expect(span?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps markdown task-list checkboxes visible after TipTap 3 a11y node view", () => {
    const editor = mountEditor();
    const inputs = checkboxBoxes(editor);
    expect(inputs).toHaveLength(2);

    for (const input of inputs) {
      const box = visualBox(input);
      expect(box).toBeTruthy();
      expect(box?.getAttribute("style")).toBeNull();
      expect(box?.style.width).not.toBe("1px");
      expect(box?.style.clip).not.toContain("rect(0");
      expect(box?.textContent).toBe("");
      expect(box?.getAttribute("aria-hidden")).toBe("true");
      expect(input.getAttribute("aria-label")).toMatch(/Task item checkbox/);
    }

    expect(inputs[0]?.checked).toBe(false);
    expect(inputs[1]?.checked).toBe(true);
  });

  it("keeps the painted box revealed after toggling checked", () => {
    const editor = mountEditor("- [ ] Toggle me");
    const input = checkboxBoxes(editor)[0];
    expect(input).toBeTruthy();
    input!.click();
    const box = visualBox(input!);
    expect(input!.checked).toBe(true);
    expect(box?.getAttribute("style")).toBeNull();
    expect(box?.textContent).toBe("");
    expect(box?.getAttribute("aria-hidden")).toBe("true");
  });
});
