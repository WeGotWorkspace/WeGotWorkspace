import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { syncPersistedCommentMarks } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "./docs-comments-types";

export function useDocsCommentsSync(editor: Editor | null, threads: DocsCommentThread[]): void {
  useEffect(() => {
    if (!editor) return;

    const syncMarks = () => {
      syncPersistedCommentMarks(editor, threads);
    };

    syncMarks();
    editor.on("update", syncMarks);
    return () => {
      editor.off("update", syncMarks);
    };
  }, [editor, threads]);
}
