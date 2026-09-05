import type { Editor } from "@tiptap/react";

/**
 * Controls whose pointer events must not be redirected into the editor
 * (send/cancel, format-bar, mention/slash menus, chips, dialogs).
 */
export const TEXT_EDITOR_CHROME_CONTROL_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[role='option']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='menu']",
  "[role='dialog']",
  "[data-radix-popper-content-wrapper]",
].join(", ");

export function shouldFocusTextEditorFromChromeTarget(
  target: EventTarget | null,
  editor: Editor | null,
): boolean {
  if (!editor?.isEditable) return false;
  if (!(target instanceof Element)) return false;
  if (editor.view.dom.contains(target)) return false;
  if (target.closest(TEXT_EDITOR_CHROME_CONTROL_SELECTOR)) return false;
  return true;
}

/** Focus the editor at the end when chrome (padding, empty card) is clicked. */
export function focusTextEditorFromChromeEvent(
  event: Pick<Event, "target"> & { preventDefault: () => void },
  editor: Editor | null,
): boolean {
  if (!shouldFocusTextEditorFromChromeTarget(event.target, editor) || !editor) {
    return false;
  }
  // Keep the caret: default mousedown on non-focusable chrome blurs the editor.
  event.preventDefault();
  return editor.commands.focus("end", { scrollIntoView: false });
}
