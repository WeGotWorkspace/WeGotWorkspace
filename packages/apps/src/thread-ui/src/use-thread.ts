import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadSubjectAdapter,
} from "@/lib/models/thread-types";

/** How often an open thread asks `/changes`, until the `ThreadEntry` push type lands (chunk C). */
export const THREAD_POLL_MS = 15_000;

/** Why a comment did not land; the panel shows it next to "Not sent". */
export type ThreadSendFailure = "gone" | "forbidden" | "moved" | "invalid" | "network";

export type ThreadViewEntry = ThreadEntry & {
  /** Sent by this tab, not taken by the server yet. */
  pending?: boolean;
  failed?: ThreadSendFailure;
};

export type ThreadStatus = "loading" | "ready" | "gone" | "offline" | "error";

export type UseThreadResult = {
  status: ThreadStatus;
  /** Comments in time order, each with its replies; activity entries are left out (2026-11-18). */
  roots: { entry: ThreadViewEntry; replies: ThreadViewEntry[] }[];
  /** Comments plus replies, tombstones left out. */
  count: number;
  /** The adapter's view and the server's must both allow posting. */
  canPost: boolean;
  post: (body: string, mentions: { id: string }[], parentId?: string | null) => Promise<void>;
  retry: (entryId: string) => Promise<void>;
  discard: (entryId: string) => void;
  edit: (entryId: string, body: string) => Promise<void>;
  remove: (entryId: string) => Promise<void>;
  react: (entryId: string, emoji: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function failureOf(error: unknown): ThreadSendFailure {
  if (!(error instanceof ThreadRequestError)) return "network";
  if (error.status === 404) return "gone";
  if (error.status === 403) return "forbidden";
  if (error.status === 409 && error.code === "subject_moved") return "moved";
  return "invalid";
}

function byTime(a: ThreadEntry, b: ThreadEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * One subject's thread: loads it, keeps it fresh while it is on screen, and
 * posts, edits, deletes and reacts. A new comment shows at once as
 * "Sending…" under its client ULID, so a retry can never make a second copy.
 */
export function useThread(client: ThreadClient, adapter: ThreadSubjectAdapter): UseThreadResult {
  const { subject } = adapter;
  const subjectKey = `${subject.type}:${subject.id}`;
  const [entries, setEntries] = useState<Map<string, ThreadViewEntry>>(() => new Map());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [status, setStatus] = useState<ThreadStatus>("loading");
  const [serverCanPost, setServerCanPost] = useState(true);
  const stateRef = useRef<string | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const upsert = useCallback((entry: ThreadViewEntry) => {
    setEntries((previous) => new Map(previous).set(entry.id, entry));
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await client.list(subjectRef.current, null, signal);
        if (signal?.aborted) return;
        stateRef.current = page.state;
        setServerCanPost(page.canPost);
        setEntries((previous) => {
          const next = new Map<string, ThreadViewEntry>();
          for (const entry of page.list) next.set(entry.id, entry);
          // Comments this tab has not landed yet stay where they are.
          for (const local of previous.values()) {
            if ((local.pending || local.failed) && !next.has(local.id)) next.set(local.id, local);
          }
          return next;
        });
        setStatus("ready");
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ThreadRequestError && error.status === 404) setStatus("gone");
        else if (typeof navigator !== "undefined" && navigator.onLine === false)
          setStatus("offline");
        else setStatus((current) => (current === "ready" ? current : "error"));
      }
    },
    [client],
  );

  const refresh = useCallback(async () => {
    const since = stateRef.current;
    if (since === null) return load();
    try {
      const changes = await client.changes(subjectRef.current, since);
      if (changes.changed.length > 0 || changes.removed.length > 0 || changes.hasMoreChanges) {
        await load();
      } else {
        stateRef.current = changes.newState;
      }
    } catch (error) {
      if (error instanceof ThreadRequestError && (error.status === 404 || error.status === 400)) {
        await load();
      }
    }
  }, [client, load]);

  useEffect(() => {
    const controller = new AbortController();
    stateRef.current = null;
    setEntries(new Map());
    setStatus("loading");
    void load(controller.signal);
    return () => controller.abort();
  }, [load, subjectKey]);

  // Fresh while on screen: a poll while the page is visible, and on focus.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, THREAD_POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, subjectKey]);

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
    [client, upsert],
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
    [send],
  );

  const retry = useCallback(
    async (entryId: string) => {
      const local = entriesRef.current.get(entryId);
      if (local) await send(local);
    },
    [send],
  );

  const discard = useCallback((entryId: string) => {
    setEntries((previous) => {
      const next = new Map(previous);
      for (const entry of previous.values()) {
        if (entry.id === entryId || (entry.parentId === entryId && entry.failed))
          next.delete(entry.id);
      }
      return next;
    });
  }, []);

  const write = useCallback(
    async (run: () => Promise<ThreadEntry>) => {
      try {
        upsert(await run());
      } catch (error) {
        if (error instanceof ThreadRequestError && (error.status === 403 || error.status === 404)) {
          await load();
          return;
        }
        throw error;
      }
    },
    [load, upsert],
  );

  const edit = useCallback(
    (entryId: string, body: string) => write(() => client.edit(subjectRef.current, entryId, body)),
    [client, write],
  );
  const remove = useCallback(
    (entryId: string) => write(() => client.remove(subjectRef.current, entryId)),
    [client, write],
  );
  const react = useCallback(
    (entryId: string, emoji: string) =>
      write(() => client.react(subjectRef.current, entryId, emoji)),
    [client, write],
  );

  const { roots, count } = useMemo(() => {
    const visible = [...entries.values()].filter((entry) => entry.kind !== "activity").sort(byTime);
    const repliesOf = new Map<string, ThreadViewEntry[]>();
    for (const entry of visible) {
      if (entry.kind === "reply" && entry.parentId) {
        repliesOf.set(entry.parentId, [...(repliesOf.get(entry.parentId) ?? []), entry]);
      }
    }
    const rootList = visible
      .filter((entry) => entry.kind === "comment")
      .map((entry) => ({ entry, replies: repliesOf.get(entry.id) ?? [] }));
    const total = visible.filter((entry) => !entry.deletedAt).length;
    return { roots: rootList, count: total };
  }, [entries]);

  return {
    status,
    roots,
    count,
    canPost: adapter.canPost && serverCanPost,
    post,
    retry,
    discard,
    edit,
    remove,
    react,
    refresh,
  };
}
