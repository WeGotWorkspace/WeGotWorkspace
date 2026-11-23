import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type { ChatMentionPrincipal, ChatSendPayload } from "@/lib/models/chat-types";
import {
  meetRoomChatEchoId,
  type MeetChannelChatSend,
} from "@/meet-core/src/meet-channel-chat-echo";
import {
  meetChannelMessages,
  meetThreadParent,
  meetThreadReplies,
  upsertMeetChatMessage,
} from "@/meet-core/src/meet-chat-thread";
import type { ChatMessage, MeetChatOperations } from "@/lib/models/meet-types";

export type MeetActiveThread = {
  parent: ChatMessage;
  replies: ChatMessage[];
  directory: ChatMentionPrincipal[];
};

/** A deleted message can be taken back for this long; then the delete is sent. */
const DELETE_UNDO_MS = 10_000;

/** Whether the key is typed into a plain text field, whose own Undo is the browser's. */
function inPlainTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea") != null;
}

export type UseMeetChatSessionArgs = {
  initialMessages: ChatMessage[];
  operations?: MeetChatOperations;
  selectedChannelId: string | null;
  author: { id: string; displayName: string };
  directory: ChatMentionPrincipal[];
  initialThreadId?: string | null;
};

export function useMeetChatSession({
  initialMessages,
  operations,
  selectedChannelId,
  author,
  directory,
  initialThreadId = null,
}: UseMeetChatSessionArgs) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  /** Messages deleted on screen whose delete is still within its Undo window: id -> when. */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlyMap<string, number>>(new Map());
  const { showError } = useAppToast();
  const { queueMutation, undoLatest } = useQueuedMutation({
    delayMs: DELETE_UNDO_MS,
    onMutationError: () => showError("Could not delete the message."),
  });
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Live inbound sync patches the bootstrap messages (new identity); adopt them
  // wholesale — the cache is the source of truth and already contains local
  // pending writes. Mock/story trees pass a stable array, so this never fires
  // there (the mount-time run bails on identical state).
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Pending deletes show as deleted at once, also when a live sync hands back the
  // stored row while the Undo window is open.
  const shownMessages = useMemo(
    () =>
      pendingDeletes.size === 0
        ? messages
        : messages.map((row) => {
            const deletedAt = pendingDeletes.get(row.id);
            return deletedAt === undefined
              ? row
              : { ...row, deletedAt, body: "", previews: [], mentions: [] };
          }),
    [messages, pendingDeletes],
  );
  const channelMessages = useMemo(
    () => meetChannelMessages(shownMessages, selectedChannelId),
    [shownMessages, selectedChannelId],
  );
  const parent = useMemo(
    () => meetThreadParent(shownMessages, threadId),
    [shownMessages, threadId],
  );
  const replies = useMemo(
    () => meetThreadReplies(shownMessages, parent?.id ?? null),
    [shownMessages, parent?.id],
  );
  const activeThread = useMemo<MeetActiveThread | null>(
    () => (parent ? { parent, replies, directory } : null),
    [directory, parent, replies],
  );

  const applyMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => upsertMeetChatMessage(current, message));
  }, []);

  /**
   * The id is handed back before the save settles: the live call posts its room
   * copy with it straight away, so a guest never waits on the channel write.
   */
  const sendChannel = useCallback(
    (payload: ChatSendPayload): MeetChannelChatSend => {
      if (!selectedChannelId) return { echoId: null, saved: Promise.resolve(null) };
      const messageId = operations?.newMessageId?.() ?? `local-${Date.now()}`;
      const saved = (async (): Promise<ChatMessage> => {
        const row = operations?.sendMessage
          ? await operations.sendMessage(selectedChannelId, payload.body, {
              messageId,
              mentions: payload.mentions,
            })
          : {
              id: messageId,
              channelId: selectedChannelId,
              authorId: author.id,
              authorName: author.displayName,
              body: payload.body,
              createdAt: Date.now(),
              reactions: [],
              mentions: payload.mentions,
              previews: [],
            };
        applyMessage(row);
        return row;
      })();
      return { echoId: meetRoomChatEchoId(messageId), saved };
    },
    [applyMessage, author, operations, selectedChannelId],
  );

  const sendThreadReply = useCallback(
    async (payload: ChatSendPayload) => {
      if (!parent) return;
      if (operations?.reply) {
        const next = await operations.reply(parent.id, payload.body, {
          mentions: payload.mentions,
        });
        setMessages((current) => {
          const withReply = upsertMeetChatMessage(current, next);
          return withReply.map((row) =>
            row.id === parent.id ? { ...row, replyCount: (row.replyCount ?? 0) + 1 } : row,
          );
        });
        return;
      }
      applyMessage({
        id: `local-reply-${Date.now()}`,
        channelId: parent.channelId,
        authorId: author.id,
        authorName: author.displayName,
        body: payload.body,
        createdAt: Date.now(),
        reactions: [],
        mentions: payload.mentions,
        previews: [],
        parentId: parent.id,
        threadId: parent.threadId ?? parent.id,
      });
    },
    [applyMessage, author, operations, parent],
  );

  const editMessage = useCallback(
    async (messageId: string, payload: ChatSendPayload) => {
      if (operations?.editMessage) {
        applyMessage(await operations.editMessage(messageId, payload.body));
      } else {
        setMessages((current) =>
          current.map((row) =>
            row.id === messageId
              ? { ...row, body: payload.body, editedAt: Date.now(), mentions: payload.mentions }
              : row,
          ),
        );
      }
      setEditingMessageId(null);
    },
    [applyMessage, operations],
  );

  /**
   * Shows the message as deleted at once and sends the delete after the Undo window
   * (the suite's irreversible write: Undo cancels it; leaving the page sends it).
   */
  const deleteMessage = useCallback(
    (messageId: string) => {
      const deletedAt = Date.now();
      // A send that never reached the server (pending or failed): nothing to take back, and holding the
      // delete would let the queued send go out first. Cancel it at once.
      if (messagesRef.current.find((row) => row.id === messageId)?.syncState != null) {
        void operations
          ?.deleteMessage?.(messageId)
          .catch(() => showError("Could not delete the message."));
        setMessages((current) =>
          current.map((row) =>
            row.id === messageId
              ? { ...row, deletedAt, body: "", previews: [], mentions: [] }
              : row,
          ),
        );
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
    [operations, queueMutation, showError],
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

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (operations?.react) {
        applyMessage(await operations.react(messageId, emoji));
        return;
      }
      setMessages((current) =>
        current.map((row) => {
          if (row.id !== messageId) return row;
          const existing = row.reactions.find((reaction) => reaction.emoji === emoji);
          const authors = existing?.authors ?? [];
          const nextAuthors = authors.includes(author.id)
            ? authors.filter((id) => id !== author.id)
            : [...authors, author.id];
          return {
            ...row,
            reactions: [
              ...row.reactions.filter((reaction) => reaction.emoji !== emoji),
              ...(nextAuthors.length > 0 ? [{ emoji, authors: nextAuthors }] : []),
            ],
          };
        }),
      );
    },
    [applyMessage, author.id, operations],
  );

  const openThread = useCallback((message: ChatMessage) => {
    setThreadId(message.parentId ?? message.threadId ?? message.id);
  }, []);

  const closeThread = useCallback(() => {
    setThreadId(null);
  }, []);

  return {
    messages: shownMessages,
    channelMessages,
    threadOpen: Boolean(activeThread),
    activeThread,
    editingMessageId,
    setEditingMessageId,
    sendChannel,
    sendThreadReply,
    editMessage,
    deleteMessage,
    react,
    openThread,
    closeThread,
  };
}
