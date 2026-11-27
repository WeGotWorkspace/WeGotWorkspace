import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { DocsImageLayoutAttrs } from "@/text-editor-core/src/text-editor-image-attrs";
import { toDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

export function insertDocsImage(editor: Editor, src: string, alt = ""): boolean {
  return editor.chain().focus().setImage({ src, alt }).run();
}

export function insertDocsImageFromNodeId(editor: Editor, nodeId: string, alt = ""): boolean {
  return insertDocsImage(editor, toDriveFnSrc(nodeId), alt);
}

export function isDocsImageNodeSelection(editor: Editor): boolean {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image";
}

export function deleteDocsImageAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return false;
  return editor.chain().setNodeSelection(pos).deleteSelection().run();
}

export function deleteSelectedDocsImage(editor: Editor): boolean {
  if (!isDocsImageNodeSelection(editor)) return false;
  return editor.commands.deleteSelection();
}

/** Collapse a NodeSelection so hover-only chrome stays, but the selected ring clears. */
export function deselectDocsImage(editor: Editor): boolean {
  if (!isDocsImageNodeSelection(editor)) return false;
  const { selection, doc, schema } = editor.state;
  const nearAfter = TextSelection.findFrom(doc.resolve(selection.to), 1, true);
  if (nearAfter) {
    editor.view.dispatch(editor.state.tr.setSelection(nearAfter));
    return !isDocsImageNodeSelection(editor);
  }
  const nearBefore = TextSelection.findFrom(doc.resolve(selection.from), -1, true);
  if (nearBefore) {
    editor.view.dispatch(editor.state.tr.setSelection(nearBefore));
    return !isDocsImageNodeSelection(editor);
  }
  if (!schema.nodes.paragraph) return false;
  const insertAt = selection.to;
  return editor
    .chain()
    .insertContentAt(insertAt, { type: "paragraph" })
    .setTextSelection(insertAt + 1)
    .run();
}

/** Width, alignment and caption of the image at `pos`; one transaction, one undo step. */
export function setDocsImageLayoutAt(
  editor: Editor,
  pos: number,
  attrs: Partial<DocsImageLayoutAttrs>,
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
  return true;
}

/** Swap the picture of the image at `pos`, keeping its width, alignment and caption. */
export function replaceDocsImageAt(editor: Editor, pos: number, nodeId: string, alt = ""): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      src: toDriveFnSrc(nodeId),
      alt,
    }),
  );
  return true;
}
