import type { Editor } from "@tiptap/react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import {
  findCommentMarkIdInSelection,
  syncPersistedCommentMarks,
} from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "../docs-comments-types";

export function markCommentThreadActive(
  threadId: string,
  activeThreadIdRef: MutableRefObject<string | null>,
  dismissedSelectionRef: MutableRefObject<{ from: number; to: number } | null>,
  setActiveThreadId: Dispatch<SetStateAction<string | null>>,
): void {
  dismissedSelectionRef.current = null;
  activeThreadIdRef.current = threadId;
  setActiveThreadId(threadId);
}

/**
 * `openThreads` is null while the Doc's thread list has not loaded: the marks
 * are then left alone, since an empty list would strip every one of them.
 */
function syncMarksWhenLoaded(editor: Editor, openThreads: DocsCommentThread[] | null): void {
  if (openThreads) syncPersistedCommentMarks(editor, openThreads);
}

export function activateCommentThreadInEditor(
  editor: Editor,
  threadId: string,
  openThreads: DocsCommentThread[] | null,
  clickPos?: number,
): void {
  syncMarksWhenLoaded(editor, openThreads);

  if (clickPos != null) {
    editor.commands.selectComment(threadId, { caretPos: clickPos });
    return;
  }

  const { empty, $anchor } = editor.state.selection;
  if (!empty) {
    editor.commands.selectComment(threadId, { caretPos: $anchor.pos });
    return;
  }

  editor.commands.selectComment(threadId);
}

export function selectCommentThreadInEditor(
  editor: Editor,
  threadId: string,
  openThreads: DocsCommentThread[] | null,
  openThreadIds: Set<string>,
): void {
  syncMarksWhenLoaded(editor, openThreads);

  const { empty, $anchor } = editor.state.selection;
  const selectedMarkId = findCommentMarkIdInSelection(editor, { allowedIds: openThreadIds });

  if (selectedMarkId === threadId) {
    if (empty) {
      editor.commands.selectComment(threadId, { preserveSelection: true });
    } else {
      editor.commands.selectComment(threadId, { caretPos: $anchor.pos });
    }
    return;
  }

  editor.commands.selectComment(threadId, { caretAt: "start" });
}
