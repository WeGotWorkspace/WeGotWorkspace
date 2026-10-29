import type { Editor } from "@tiptap/react";

/**
 * True while `editor` can still be used. TipTap nulls an editor's extension and
 * command managers when it is destroyed. A change to a `useEditor` dep destroys
 * the editor and builds a new one, and React code can hold the old instance for
 * one more render (#1738).
 *
 * Unlike `editor.isDestroyed`, this is also true before the view is mounted.
 */
export function isLiveEditor(editor: Editor | null | undefined): editor is Editor {
  if (!editor) return false;
  return (editor as unknown as { extensionManager: unknown }).extensionManager != null;
}
