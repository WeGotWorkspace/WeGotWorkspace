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
  // Read inside timers and the unmount flush, which must not see stale props.
  const latest = useRef({ fileThreads, ensureSuggestionRoot });
  useEffect(() => {
    latest.current = { fileThreads, ensureSuggestionRoot };
  });

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDueAt = useRef(0);
  const unmounted = useRef(false);
  const createMissingRootsRef = useRef<() => void>(() => {});

  /** This session's change ids that have no thread root yet. Reads the editor. */
  const missingChangeIds = useCallback(() => {
    if (!enabled || !editor || editor.isDestroyed || !editorHasTrackChanges(editor)) return [];
    const withThread = new Set(
      latest.current.fileThreads.flatMap((thread) =>
        thread.kind === "suggestion" && thread.changeId ? [thread.changeId] : [],
      ),
    );
    return getSessionTrackChangeIds(editor).filter((changeId) => !withThread.has(changeId));
  }, [editor, enabled]);

  /** Make sure a retry runs no later than `dueAt`; an earlier timer is kept. */
  const armRetry = useCallback((dueAt: number) => {
    if (unmounted.current) return;
    if (retryTimer.current && retryDueAt.current <= dueAt) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryDueAt.current = dueAt;
    retryTimer.current = setTimeout(
      () => {
        retryTimer.current = null;
        createMissingRootsRef.current();
      },
      Math.max(0, dueAt - Date.now()),
    );
  }, []);

  const createRoots = useCallback(
    (changeIds: string[]) => {
      const { ensureSuggestionRoot: ensure } = latest.current;
      const now = Date.now();
      for (const changeId of changeIds) {
        const failed = failedAt.current.get(changeId);
        if (failed !== undefined && now - failed < SUGGESTION_ROOT_RETRY_MS) {
          armRetry(failed + SUGGESTION_ROOT_RETRY_MS);
          continue;
        }
        ensure(changeId).then(
          () => failedAt.current.delete(changeId),
          () => {
            const failedNow = Date.now();
            failedAt.current.set(changeId, failedNow);
            // The cooldown is not a timer: schedule the next attempt, which stops
            // once the root exists or the change is gone.
            armRetry(failedNow + SUGGESTION_ROOT_RETRY_MS);
          },
        );
      }
    },
    [armRetry],
  );

  const createMissingRoots = useCallback(
    () => createRoots(missingChangeIds()),
    [createRoots, missingChangeIds],
  );
  useEffect(() => {
    createMissingRootsRef.current = createMissingRoots;
  }, [createMissingRoots]);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Taken while the editor is alive: it can be destroyed before this cleanup runs.
    let snapshot: string[] = [];
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction?.docChanged) return;
      if (timer) clearTimeout(timer);
      snapshot = missingChangeIds();
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
        createRoots(snapshot);
      }
    };
  }, [createMissingRoots, createRoots, missingChangeIds, editor]);

  // On mount, and again whenever the thread list changes (a reload after a failed create).
  useEffect(() => {
    createMissingRoots();
  }, [createMissingRoots, fileThreads]);
}
