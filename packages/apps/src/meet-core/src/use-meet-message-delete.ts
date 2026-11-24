import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type { ChatMessage, MeetChatOperations } from "@/lib/models/meet-types";

/** A deleted message can be taken back for this long; then the delete is sent. */
const DELETE_UNDO_MS = 10_000;

/** Whether the key is typed into a plain text field, whose own Undo is the browser's. */
function inPlainTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea") != null;
}

export function useMeetMessageDelete({
  messagesRef,
  setMessages,
  operations,
}: {
  messagesRef: { readonly current: ChatMessage[] };
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  operations?: MeetChatOperations;
}) {
  /** Messages deleted on screen whose delete is still within its Undo window: id -> when. */
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlyMap<string, number>>(new Map());
  const { showError } = useAppToast();
  const { queueMutation, undoLatest } = useQueuedMutation({
    delayMs: DELETE_UNDO_MS,
    onMutationError: () => showError("Could not delete the message."),
  });

  /**
   * Shows the message as deleted at once and sends the delete after the Undo window
   * (the suite's irreversible write: Undo cancels it; leaving the page sends it).
   */
  const deleteMessage = useCallback(
    (messageId: string) => {
      const deletedAt = Date.now();
      // A send that never reached the server (queued, pending or failed): nothing to take back, and
      // holding the delete would let the queued send go out first. Cancel it at once. An edit or delete
      // of a saved message still queued does not count: the server has that message.
      const before = messagesRef.current.find((row) => row.id === messageId);
      if (before?.sendQueued) {
        setMessages((current) =>
          current.map((row) =>
            row.id === messageId
              ? { ...row, deletedAt, body: "", previews: [], mentions: [] }
              : row,
          ),
        );
        void operations?.deleteMessage?.(messageId).catch(() => {
          setMessages((current) => current.map((row) => (row.id === messageId ? before : row)));
          showError("Could not delete the message.");
        });
        return;
      }
      setPendingDeletes((current) => new Map(current).set(messageId, deletedAt));
      const release = () =>
        setPendingDeletes((current) => {
          const next = new Map(current);
          next.delete(messageId);
          return next;
        });
      queueMutation({
        key: `meet:delete:${messageId}`,
        toastMessage: "Message deleted",
        irreversible: true,
        execute: async (signal) => {
          await operations?.deleteMessage?.(messageId, { signal });
          if (signal.aborted) return;
          setMessages((current) =>
            current.map((row) =>
              row.id === messageId
                ? { ...row, deletedAt, body: "", previews: [], mentions: [] }
                : row,
            ),
          );
          release();
        },
        undo: release,
        onError: release,
        undoToastMessage: "Deletion undone.",
      });
    },
    [messagesRef, operations, queueMutation, setMessages, showError],
  );

  // Cmd/Ctrl+Z takes back the latest delete, unless a text field has its own Undo to
  // run: the composer handles the key first when it has typing to undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "z") return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (inPlainTextField(event.target)) return;
      if (undoLatest()) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [undoLatest]);

  return { pendingDeletes, deleteMessage };
}
