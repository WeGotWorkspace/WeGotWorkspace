import type { Editor } from "@tiptap/react";
import { toDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

export function insertDocsImage(editor: Editor, src: string, alt = ""): boolean {
  return editor.chain().focus().setImage({ src, alt }).run();
}

export function insertDocsImageFromNodeId(editor: Editor, nodeId: string, alt = ""): boolean {
  return insertDocsImage(editor, toDriveFnSrc(nodeId), alt);
}
