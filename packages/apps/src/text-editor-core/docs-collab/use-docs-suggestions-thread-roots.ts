import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  editorHasTrackChanges,
  getSessionTrackChangeIds,
} from "@/text-editor-core/src/text-editor-track-changes";
import type { DocsFileThread } from "./docs-threads-types";

/** Wait for a typing burst to settle before creating its thread root. */
export const SUGGESTION_ROOT_SETTLE_MS = 800;
/** After a failed create (offline, server error), try that change again after this long. */
export const SUGGESTION_ROOT_RETRY_MS = 10_000;

type UseDocsSuggestionThreadRootsOptions = {
  editor: Editor | null;
  fileThreads: DocsFileThread[];
  ensureSuggestionRoot: (changeId: string) => Promise<DocsFileThread>;
  enabled: boolean;
};

/**
 * Creates the suggestion thread root as soon as this editor session makes a
 * suggestion, so author and time come from the thread instead of the document.
 * Only the session's own change ids are considered (see
 * `getSessionTrackChangeIds`): a peer's suggestion is created by that peer.
 * `ensureSuggestionRoot` is idempotent per change id.
 */
export function useDocsSuggestionThreadRoots({
  editor,
  fileThreads,
  ensureSuggestionRoot,
  enabled,
}: UseDocsSuggestionThreadRootsOptions): void {
  const failedAt = useRef(new Map<string, number>());
  const latest = useRef({ fileThreads, ensureSuggestionRoot });
  useEffect(() => {
    latest.current = { fileThreads, ensureSuggestionRoot };
  });

  const createMissingRoots = useCallback(() => {
    if (!enabled || !editor || editor.isDestroyed || !editorHasTrackChanges(editor)) return;
    const { fileThreads: threads, ensureSuggestionRoot: ensure } = latest.current;
    const withThread = new Set(
      threads.flatMap((thread) =>
        thread.kind === "suggestion" && thread.changeId ? [thread.changeId] : [],
      ),
    );
    const now = Date.now();
    for (const changeId of getSessionTrackChangeIds(editor)) {
      if (withThread.has(changeId)) continue;
      const failed = failedAt.current.get(changeId);
      if (failed !== undefined && now - failed < SUGGESTION_ROOT_RETRY_MS) continue;
      ensure(changeId).then(
        () => failedAt.current.delete(changeId),
        () => failedAt.current.set(changeId, Date.now()),
      );
    }
  }, [editor, enabled]);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction?.docChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        createMissingRoots();
      }, SUGGESTION_ROOT_SETTLE_MS);
    };

    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (timer) {
        clearTimeout(timer);
        // Closing the document right after suggesting still records the author.
        createMissingRoots();
      }
    };
  }, [createMissingRoots, editor]);

  // On mount, and again whenever the thread list changes (a reload after a failed create).
  useEffect(() => {
    createMissingRoots();
  }, [createMissingRoots, fileThreads]);
}
