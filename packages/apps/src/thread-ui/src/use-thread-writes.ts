import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadSubjectAdapter,
  type ThreadSubjectRef,
} from "@/lib/models/thread-types";
import {
  failureOf,
  type ThreadSendFailure,
  type ThreadViewEntry,
} from "@/thread-ui/src/thread-view";

export type ThreadWriteDeps = {
  client: ThreadClient;
  subjectRef: MutableRefObject<ThreadSubjectRef>;
  adapterRef: MutableRefObject<ThreadSubjectAdapter>;
  entriesRef: MutableRefObject<Map<string, ThreadViewEntry>>;
  setEntries: Dispatch<SetStateAction<Map<string, ThreadViewEntry>>>;
  setWriteError: Dispatch<SetStateAction<ThreadSendFailure | null>>;
  /** Marks a write as landed now, so a `list` that started earlier keeps it. */
  markLanded: (entryId: string) => void;
  /** Marks a write failure as recorded now, so a `load` that started earlier keeps it. */
  markFailed: () => void;
  upsert: (entry: ThreadViewEntry) => void;
  load: () => Promise<void>;
};

/** Posting (optimistic, under a client ULID), retry, discard, edit, delete and react. */
export function useThreadWrites({
  client,
  subjectRef,
  adapterRef,
  entriesRef,
  setEntries,
  setWriteError,
  markLanded,
  markFailed,
  upsert,
  load,
}: ThreadWriteDeps) {
  const send = useCallback(
    async (local: ThreadViewEntry) => {
      upsert({ ...local, pending: true, failed: undefined });
      try {
        const saved = await client.post(subjectRef.current, {
          id: local.id,
          body: local.body ?? "",
          parentId: local.parentId,
          scopeId: adapterRef.current.scopeId,
          mentions: local.mentions.map((mention) => ({ id: mention.id })),
        });
        markLanded(saved.id);
        setEntries((previous) => {
          const next = new Map(previous);
          next.delete(local.id);
          next.set(saved.id, saved);
          return next;
        });
      } catch (error) {
        upsert({ ...local, pending: false, failed: failureOf(error) });
      }
    },
    [adapterRef, client, markLanded, setEntries, subjectRef, upsert],
  );

  const post = useCallback(
    async (body: string, mentions: { id: string }[], parentId: string | null = null) => {
      const me = adapterRef.current.me;
      const local: ThreadViewEntry = {
        id: createChatMessageUlid(),
        kind: parentId ? "reply" : "comment",
        parentId,
        author: { username: me.id, displayName: me.displayName },
        body,
        mentions: mentions.map((mention) => ({
          id: mention.id,
          displayName:
            adapterRef.current.people.find((person) => person.id === mention.id)?.displayName ??
            mention.id,
        })),
        reactions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        activity: null,
      };
      await send(local);
    },
    [adapterRef, send],
  );

  const retry = useCallback(
    async (entryId: string) => {
      const local = entriesRef.current.get(entryId);
      if (local) await send(local);
    },
    [entriesRef, send],
  );

  const discard = useCallback(
    (entryId: string) => {
      setEntries((previous) => {
        const next = new Map(previous);
        for (const entry of previous.values()) {
          if (entry.id === entryId || (entry.parentId === entryId && entry.failed))
            next.delete(entry.id);
        }
        return next;
      });
    },
    [setEntries],
  );

  const write = useCallback(
    async (run: () => Promise<ThreadEntry>): Promise<boolean> => {
      setWriteError(null);
      try {
        upsert(await run());
        return true;
      } catch (error) {
        const failure = failureOf(error);
        markFailed();
        setWriteError(failure);
        if (error instanceof ThreadRequestError && (error.status === 403 || error.status === 404)) {
          await load();
          // The reload is a clean read; the refused write still needs its reason shown.
          markFailed();
          setWriteError(failure);
        }
        return false;
      }
    },
    [load, markFailed, setWriteError, upsert],
  );

  const edit = useCallback(
    (entryId: string, body: string) => write(() => client.edit(subjectRef.current, entryId, body)),
    [client, subjectRef, write],
  );
  const remove = useCallback(
    (entryId: string) => write(() => client.remove(subjectRef.current, entryId)),
    [client, subjectRef, write],
  );
  const react = useCallback(
    (entryId: string, emoji: string) =>
      write(() => client.react(subjectRef.current, entryId, emoji)),
    [client, subjectRef, write],
  );

  return { post, retry, discard, edit, remove, react };
}
