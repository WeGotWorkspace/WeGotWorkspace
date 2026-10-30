import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { onPageExit } from "@/lib/page-exit";

/** Arguments for a single deferred API write (undo + `AbortSignal` while pending). */
export type DeferredApiWriteArgs = {
  key: string;
  toastMessage: string;
  execute: (signal: AbortSignal) => Promise<void>;
  undo: () => void;
  onError?: () => void;
  undoToastMessage?: string;
  icon?: ReactNode;
  /** When true, run `execute` immediately instead of waiting `delayMs`. */
  executeImmediately?: boolean;
};

type PendingMutation = {
  key: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** Unsubscribes the page-exit flush while the write waits for its delay. */
  releasePageExit: (() => void) | null;
  toastId: string | number;
  controller: AbortController | null;
  started: boolean;
  cancelledByUndo: boolean;
  undo: () => void;
  undoToastMessage?: string;
};

type UseQueuedMutationOptions = {
  delayMs?: number;
  onMutationError: () => void;
};

/** Stops a write that has not started yet from starting on its timer or on page exit. */
function cancelPendingStart(entry: PendingMutation): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.releasePageExit?.();
  entry.releasePageExit = null;
}

/**
 * Queues **deferred** API writes: shows a Callout toast with **Undo**, waits `delayMs`,
 * then runs `execute(AbortSignal)`. Undo clears the timer, aborts the in-flight request
 * if already started, rolls back via `undo`, and shows `undoToastMessage`.
 *
 * A write the UI shows as done is always sent (#1794): when the page is reloaded, closed
 * or left, pending writes start right away (with `keepalive`, see `wgwFetch`). Pending
 * writes and their toasts outlive the hook, so leaving the list inside the app neither
 * drops the write nor takes away Undo.
 *
 * Pair with {@link runQueuedBatchAction} for batch helpers, or call `queueMutation` directly.
 */
export function useQueuedMutation({ delayMs = 2500, onMutationError }: UseQueuedMutationOptions) {
  const { show, dismiss } = useAppToast();
  const pendingByKeyRef = useRef<Map<string, PendingMutation>>(new Map());
  const orderRef = useRef<string[]>([]);

  const removePending = useCallback((key: string) => {
    pendingByKeyRef.current.delete(key);
    orderRef.current = orderRef.current.filter((item) => item !== key);
  }, []);

  const showUndoToast = useCallback(
    (message?: string) => {
      show(message ?? "Change undone.", { severity: "info" });
    },
    [show],
  );

  const undoPending = useCallback(
    (entry: PendingMutation, { showToast }: { showToast: boolean }) => {
      if (!pendingByKeyRef.current.has(entry.key)) return false;
      cancelPendingStart(entry);
      entry.cancelledByUndo = true;
      if (entry.controller) entry.controller.abort();
      dismiss(entry.toastId);
      removePending(entry.key);
      entry.undo();
      if (showToast) showUndoToast(entry.undoToastMessage);
      return true;
    },
    [dismiss, removePending, showUndoToast],
  );

  const queueMutation = useCallback(
    ({
      key,
      toastMessage,
      execute,
      undo,
      onError,
      undoToastMessage,
      icon,
      executeImmediately = false,
    }: DeferredApiWriteArgs) => {
      const existing = pendingByKeyRef.current.get(key);
      if (existing) {
        cancelPendingStart(existing);
        dismiss(existing.toastId);
        removePending(key);
      }

      const entry: PendingMutation = {
        key,
        timer: null,
        releasePageExit: null,
        toastId: "",
        controller: null,
        started: false,
        cancelledByUndo: false,
        undo,
        undoToastMessage,
      };

      const undoWindowMs = delayMs + 3500;

      const startExecute = () => {
        if (entry.started || entry.cancelledByUndo) return;
        cancelPendingStart(entry);
        entry.started = true;
        entry.controller = new AbortController();
        void execute(entry.controller!.signal)
          .catch((error: unknown) => {
            if (entry.cancelledByUndo) return;
            if (error instanceof DOMException && error.name === "AbortError") return;
            (onError ?? undo)();
            onMutationError();
          })
          .finally(() => {
            if (executeImmediately) {
              entry.timer = setTimeout(() => {
                dismiss(entry.toastId);
                removePending(key);
              }, undoWindowMs);
            } else {
              dismiss(entry.toastId);
              removePending(key);
            }
          });
      };

      if (executeImmediately) {
        startExecute();
      } else {
        entry.timer = setTimeout(startExecute, delayMs);
        entry.releasePageExit = onPageExit(startExecute);
      }

      entry.toastId =
        show(toastMessage, {
          duration: undoWindowMs,
          severity: "success",
          canUndo: true,
          undoLabel: "Undo",
          icon,
          onUndo: () => {
            void undoPending(entry, { showToast: true });
          },
        }) ?? "";

      pendingByKeyRef.current.set(key, entry);
      orderRef.current = [...orderRef.current.filter((item) => item !== key), key];
    },
    [delayMs, dismiss, onMutationError, removePending, show, undoPending],
  );

  const undoLatest = useCallback(() => {
    const latestKey = orderRef.current[orderRef.current.length - 1];
    if (!latestKey) return false;
    const latest = pendingByKeyRef.current.get(latestKey);
    if (!latest) return false;
    return undoPending(latest, { showToast: true });
  }, [undoPending]);

  return { queueMutation, undoLatest };
}
