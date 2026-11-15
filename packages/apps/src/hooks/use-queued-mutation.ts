import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { onPageExit } from "@/lib/page-exit";

/** Fields every undoable write shares, reversible or not. */
type UndoableWriteBase = {
  key: string;
  toastMessage: string;
  /** No toast (and so no Undo), e.g. for an autosave; the write still reverts on failure. */
  silent?: boolean;
  /** Puts the screen back. Runs on Undo, and on failure unless `onError` is given. */
  undo: () => void;
  onError?: () => void;
  undoToastMessage?: string;
  icon?: ReactNode;
};

/**
 * Keys of the items the server applied, for a batch that called `markCompleted`.
 * `null` means "the whole write": `execute` resolved without marking items.
 */
export type CompletedWriteKeys = ReadonlySet<string> | null;

/**
 * Runs the items of a batch and waits for every one to settle before it rejects with the
 * first failure. `Promise.all` would reject at once and the hook would revert before a slower
 * item called `markCompleted`, leaving that item applied on the server.
 */
export async function settleAll<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

/**
 * A write the server can take back. It is sent right away, so other people see it within
 * seconds. Undo puts the screen back and then sends `revert`, a compensating write, once
 * `execute` has settled. Write `revert` as a delta (star back to its old value, move back,
 * restore from trash), never as an overwrite of the whole item, so it does not wipe a
 * change someone else made in between.
 */
export type ReversibleWriteArgs = UndoableWriteBase & {
  /**
   * Sends the write. A batch calls `markCompleted` for every item the server applied, so a
   * failure halfway reverts exactly those. Undo never aborts it: a cancelled request may
   * still land on the server, and then nothing would take it back.
   */
  execute: (signal: AbortSignal, markCompleted: (itemKey: string) => void) => Promise<void>;
  revert: (completed: CompletedWriteKeys) => Promise<void>;
  irreversible?: never;
};

/**
 * A write the server cannot take back (a hard delete). It waits for the grace period, so
 * Undo only has to cancel it. On page exit it is sent at once (#1794).
 */
export type IrreversibleWriteArgs = UndoableWriteBase & {
  irreversible: true;
  execute: (signal: AbortSignal) => Promise<void>;
  revert?: never;
};

/** Every undoable write is either reversible (sent now) or irreversible (deferred). */
export type QueuedMutationArgs = ReversibleWriteArgs | IrreversibleWriteArgs;

export type QueueMutation = (args: QueuedMutationArgs) => void;

type PendingMutation = {
  key: string;
  /** Deferred start, or the end of the undo window once the write is sent. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Unsubscribes the page-exit flush while a deferred write waits for its delay. */
  releasePageExit: (() => void) | null;
  toastId: string | number;
  undo: () => void;
  undoToastMessage?: string;
};

type UseQueuedMutationOptions = {
  delayMs?: number;
  onMutationError: () => void;
};

const UNDO_WINDOW_EXTRA_MS = 3500;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function clearPendingTimers(entry: PendingMutation): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.releasePageExit?.();
  entry.releasePageExit = null;
}

type WriteRunner = {
  /** Called once when the toast's Undo (or undoLatest) is used. */
  undo: () => void;
  /** Starts the write; `settled` runs after it finished, failed or was cancelled. */
  start: (settled: () => void) => void;
};

/**
 * Sends a reversible write now. Undo waits for `execute` to settle, then reverts what the
 * server applied. A failure reverts the completed part of a batch,
 * so a batch lands whole or not at all.
 */
function reversibleRunner(args: ReversibleWriteArgs, onMutationError: () => void): WriteRunner {
  const completed = new Set<string>();
  // Never aborted: see `ReversibleWriteArgs.execute`.
  const signal = new AbortController().signal;
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  let undone = false;
  let reverted = false;

  const revertApplied = () => {
    if (reverted) return;
    // A single write that failed never landed. A batch that failed reverts its marked items.
    if (outcome === "rejected" && completed.size === 0) return;
    reverted = true;
    const keys: CompletedWriteKeys =
      completed.size > 0 ? new Set(completed) : outcome === "resolved" ? null : new Set();
    void args.revert(keys).catch((error: unknown) => {
      console.error(`Undo of ${args.key} failed`, error);
      onMutationError();
    });
  };

  return {
    undo: () => {
      if (undone) return;
      undone = true;
      args.undo();
      if (outcome !== "pending") revertApplied();
    },
    start: (settled) => {
      void args
        .execute(signal, (itemKey) => completed.add(itemKey))
        .then(
          () => {
            outcome = "resolved";
          },
          () => {
            outcome = "rejected";
            if (undone) return;
            undone = true;
            (args.onError ?? args.undo)();
            onMutationError();
            revertApplied();
          },
        )
        .finally(() => {
          if (undone) revertApplied();
          settled();
        });
    },
  };
}

/** Holds an irreversible write for the grace period; Undo cancels it or aborts the request. */
function irreversibleRunner(args: IrreversibleWriteArgs, onMutationError: () => void): WriteRunner {
  let controller: AbortController | null = null;
  let undone = false;
  return {
    undo: () => {
      if (undone) return;
      undone = true;
      controller?.abort();
      args.undo();
    },
    start: (settled) => {
      if (undone || controller) return;
      controller = new AbortController();
      void args
        .execute(controller.signal)
        .catch((error: unknown) => {
          if (undone || isAbortError(error)) return;
          (args.onError ?? args.undo)();
          onMutationError();
        })
        .finally(settled);
    },
  };
}

/**
 * Undoable API writes with a Callout toast and **Undo** (#1659 follow-up, suite-wide).
 *
 * - **Reversible** writes (`revert` given) run at once, so other people see them within
 *   seconds. Undo is a compensating write that they see too: the change appears, then goes.
 * - **Irreversible** writes (`irreversible: true`) wait `delayMs` first. Undo cancels the
 *   timer, or aborts the request if it already started. A write the UI shows as done is
 *   always sent (#1794): when the page is reloaded, closed or left, a waiting write starts
 *   right away (see `onPageExit`), with `keepalive`.
 *
 * Writes and their toasts outlive the hook, so leaving the list inside the app neither
 * drops the write nor takes away Undo.
 */
export function useQueuedMutation({ delayMs = 2500, onMutationError }: UseQueuedMutationOptions) {
  const { show, dismiss: dismissToast } = useAppToast();
  // Sonner dismisses every toast for an empty id; a silent write has none.
  const dismiss = useCallback(
    (toastId: string | number) => {
      if (toastId !== "") dismissToast(toastId);
    },
    [dismissToast],
  );
  const pendingByKeyRef = useRef<Map<string, PendingMutation>>(new Map());
  const orderRef = useRef<string[]>([]);

  const removePending = useCallback((entry: PendingMutation) => {
    if (pendingByKeyRef.current.get(entry.key) !== entry) return;
    pendingByKeyRef.current.delete(entry.key);
    orderRef.current = orderRef.current.filter((item) => item !== entry.key);
  }, []);

  const undoPending = useCallback(
    (entry: PendingMutation) => {
      if (pendingByKeyRef.current.get(entry.key) !== entry) return false;
      clearPendingTimers(entry);
      dismiss(entry.toastId);
      removePending(entry);
      entry.undo();
      show(entry.undoToastMessage ?? "Change undone.", { severity: "info" });
      return true;
    },
    [dismiss, removePending, show],
  );

  const queueMutation = useCallback<QueueMutation>(
    (args) => {
      const existing = pendingByKeyRef.current.get(args.key);
      if (existing) {
        // A newer write on the same item takes over the toast. An older reversible write keeps
        // its course; an older irreversible write that has not started is dropped.
        clearPendingTimers(existing);
        dismiss(existing.toastId);
        removePending(existing);
      }

      const runner = args.irreversible
        ? irreversibleRunner(args, onMutationError)
        : reversibleRunner(args, onMutationError);
      const entry: PendingMutation = {
        key: args.key,
        timer: null,
        releasePageExit: null,
        toastId: "",
        undo: runner.undo,
        undoToastMessage: args.undoToastMessage,
      };
      const undoWindowMs = delayMs + UNDO_WINDOW_EXTRA_MS;
      const closeWindow = () => {
        dismiss(entry.toastId);
        removePending(entry);
      };

      if (args.irreversible) {
        const start = () => {
          clearPendingTimers(entry);
          runner.start(closeWindow);
        };
        entry.timer = setTimeout(start, delayMs);
        entry.releasePageExit = onPageExit(start);
      } else {
        runner.start(() => {
          // Undo stays available for the whole window, also after the write landed.
          if (pendingByKeyRef.current.get(entry.key) !== entry || entry.timer) return;
          entry.timer = setTimeout(closeWindow, undoWindowMs);
        });
      }

      entry.toastId = args.silent
        ? ""
        : (show(args.toastMessage, {
            duration: undoWindowMs,
            severity: "success",
            canUndo: true,
            undoLabel: "Undo",
            icon: args.icon,
            onUndo: () => {
              undoPending(entry);
            },
          }) ?? "");

      pendingByKeyRef.current.set(args.key, entry);
      orderRef.current = [...orderRef.current.filter((item) => item !== args.key), args.key];
    },
    [delayMs, dismiss, onMutationError, removePending, show, undoPending],
  );

  const undoLatest = useCallback(() => {
    const latestKey = orderRef.current[orderRef.current.length - 1];
    if (!latestKey) return false;
    const latest = pendingByKeyRef.current.get(latestKey);
    if (!latest) return false;
    return undoPending(latest);
  }, [undoPending]);

  return { queueMutation, undoLatest };
}
