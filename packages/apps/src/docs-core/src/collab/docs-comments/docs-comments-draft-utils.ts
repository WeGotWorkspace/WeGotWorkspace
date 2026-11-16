import type { Editor } from "@tiptap/react";
import { readSelectedAnchorText } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

export function selectionMatchesDraftAnchor(editor: Editor, draft: DocsCommentThread): boolean {
  const { from, to } = editor.state.selection;
  if (typeof draft.anchorFrom === "number" && typeof draft.anchorTo === "number") {
    if (from === draft.anchorFrom && to === draft.anchorTo) return true;
    if (from === to && from >= draft.anchorFrom && from <= draft.anchorTo) return true;
    return false;
  }

  return readSelectedAnchorText(editor) === draft.anchorText;
}
