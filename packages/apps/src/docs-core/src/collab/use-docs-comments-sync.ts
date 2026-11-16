import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { syncPersistedCommentMarks } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

/**
 * Keeps the comment marks in the document in line with the thread list:
 * marks of resolved or deleted threads go, missing marks are re-anchored.
 *
 * Runs only once `loaded` says `threads` is the server's list for this Doc.
 * Before that (or after a failed fetch) the list is empty, every mark would
 * look unknown, and removing them would be saved as a real edit.
 */
export function useDocsCommentsSync(
  editor: Editor | null,
  threads: DocsCommentThread[],
  loaded: boolean,
): void {
  useEffect(() => {
    if (!editor || !loaded) return;

    const syncMarks = () => {
      syncPersistedCommentMarks(editor, threads);
    };

    syncMarks();
    editor.on("update", syncMarks);
    return () => {
      editor.off("update", syncMarks);
    };
  }, [editor, threads, loaded]);
}
