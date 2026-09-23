import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeViewRenderer, NodeViewRendererProps } from "@tiptap/core";
import type { Decoration, DecorationSource } from "@tiptap/pm/view";
import TaskItem from "@tiptap/extension-task-item";

/**
 * TipTap 3's TaskItem node view paints the accessible name into the sibling
 * `span` and hides that span with inline visually-hidden styles, leaving the
 * native checkbox as the visible control.
 *
 * Our editor hides that input (`sr-only`) and uses the span as the tokenized
 * checkbox box (Notes gold / Docs blue). Strip TipTap's hide so the painted
 * box stays visible; keep the name on the input `aria-label`.
 */
export function revealTaskItemCheckboxBox(dom: HTMLElement): void {
  const span = dom.querySelector(":scope > label > span");
  if (!(span instanceof HTMLElement)) return;
  span.removeAttribute("style");
  span.textContent = "";
  span.setAttribute("aria-hidden", "true");
}

function revealIfElement(dom: Element): void {
  if (dom instanceof HTMLElement) revealTaskItemCheckboxBox(dom);
}

export const TextEditorTaskItem = TaskItem.extend({
  addNodeView() {
    const render = this.parent?.() as NodeViewRenderer | undefined;
    return (props: NodeViewRendererProps) => {
      const view = render?.(props);
      if (!view) {
        return { dom: document.createElement("li") };
      }
      revealIfElement(view.dom);
      const parentUpdate = view.update?.bind(view);
      return {
        ...view,
        update: (
          updatedNode: ProseMirrorNode,
          decorations: readonly Decoration[],
          innerDecorations: DecorationSource,
        ) => {
          const ok = parentUpdate?.(updatedNode, decorations, innerDecorations) ?? true;
          if (ok) revealIfElement(view.dom);
          return ok;
        },
      };
    };
  },
});
