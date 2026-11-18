import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadPage,
  type ThreadSubjectAdapter,
} from "@/lib/models/thread-types";
import { readThreadCache, writeThreadCache } from "@/lib/offline/threads/thread-cache";

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
  /** Set when the thread shown is the offline copy: when it was last fetched (epoch ms). */
  lastUpdated: number | null;
  /** The adapter's view and the server's must both allow posting. */
  canPost: boolean;
  post: (body: string, mentions: { id: string }[], parentId?: string | null) => Promise<void>;
  retry: (entryId: string) => Promise<void>;
  discard: (entryId: string) => void;
  /** Resolves true when the change landed; a failure never throws and shows in `writeError`. */
  edit: (entryId: string, body: string) => Promise<boolean>;
  remove: (entryId: string) => Promise<boolean>;
  react: (entryId: string, emoji: string) => Promise<boolean>;
  /** Why the last edit, delete or reaction did not land; null once another one does. */
  writeError: ThreadSendFailure | null;
  clearWriteError: () => void;
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
  const statusRef = useRef(status);
  statusRef.current = status;
  const [serverCanPost, setServerCanPost] = useState(true);
  const [writeError, setWriteError] = useState<ThreadSendFailure | null>(null);
  const clearWriteError = useCallback(() => setWriteError(null), []);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const stateRef = useRef<string | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  /** Each write this tab lands gets a number, so a `list` that started earlier cannot undo it. */
  const writeSeq = useRef(0);
  const landedAt = useRef(new Map<string, number>());
  const controllerRef = useRef<AbortController | null>(null);

  const upsert = useCallback((entry: ThreadViewEntry) => {
    landedAt.current.set(entry.id, ++writeSeq.current);
    setEntries((previous) => new Map(previous).set(entry.id, entry));
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const subjectAtStart = subjectRef.current;
      const startedAfter = writeSeq.current;
      const stale = () => signal?.aborted === true;
      const isReady = () => statusRef.current === "ready";
      try {
        // The thread pages oldest first; the newest entries are on the last page.
        const list: ThreadEntry[] = [];
        let first: ThreadPage | null = null;
        let cursor: string | null = null;
        do {
          const page: ThreadPage = await client.list(subjectAtStart, cursor, signal);
          if (stale()) return;
          first ??= page;
          list.push(...page.list);
          cursor = page.nextCursor;
        } while (cursor);
        const head = first;
        const landedDuringLoad = [...landedAt.current].some(([, at]) => at > startedAfter);
        // A write that landed while the pages were in flight may be missing from them,
        // while their state already counts it: keep the old state so the next poll reloads.
        if (!landedDuringLoad) stateRef.current = head.state;
        setServerCanPost(head.canPost);
        setLastUpdated(null);
        setEntries((previous) => {
          const next = new Map<string, ThreadViewEntry>();
          for (const entry of list) next.set(entry.id, entry);
          for (const local of previous.values()) {
            const newer = (landedAt.current.get(local.id) ?? 0) > startedAfter;
            // Comments this tab has not landed yet, or landed after the request began, stay.
            if (local.pending || local.failed || newer) next.set(local.id, local);
          }
          return next;
        });
        setStatus("ready");
        void writeThreadCache(adapterRef.current.me.id, subjectAtStart, {
          entries: list,
          state: head.state,
          canPost: head.canPost,
          fetchedAt: Date.now(),
        });
      } catch (error) {
        if (stale()) return;
        if (error instanceof ThreadRequestError && error.status === 404) setStatus("gone");
        // No answer at all (a dropped request, or the browser says it is offline).
        else if (
          !(error instanceof ThreadRequestError) ||
          (typeof navigator !== "undefined" && navigator.onLine === false)
        ) {
          if (isReady()) return;
          const cached = await readThreadCache(adapterRef.current.me.id, subjectAtStart);
          if (stale() || isReady()) return;
          if (cached) {
            setEntries(new Map(cached.entries.map((entry) => [entry.id, entry])));
            setServerCanPost(cached.canPost);
            setLastUpdated(cached.fetchedAt);
            setStatus("ready");
          } else setStatus("offline");
        } else setStatus((current) => (current === "ready" ? current : "error"));
      }
    },
    [client],
  );

  const refresh = useCallback(async () => {
    const signal = controllerRef.current?.signal;
    const since = stateRef.current;
    if (since === null) return load(signal);
    const subjectAtStart = subjectRef.current;
    try {
      const changes = await client.changes(subjectAtStart, since, signal);
      if (signal?.aborted || subjectRef.current !== subjectAtStart) return;
      if (changes.changed.length > 0 || changes.removed.length > 0 || changes.hasMoreChanges) {
        await load(signal);
      } else {
        stateRef.current = changes.newState;
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof ThreadRequestError && (error.status === 404 || error.status === 400)) {
        await load(signal);
      }
    }
  }, [client, load]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    stateRef.current = null;
    landedAt.current.clear();
    setEntries(new Map());
    setLastUpdated(null);
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
        landedAt.current.set(saved.id, ++writeSeq.current);
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
    async (run: () => Promise<ThreadEntry>): Promise<boolean> => {
      setWriteError(null);
      try {
        upsert(await run());
        return true;
      } catch (error) {
        setWriteError(failureOf(error));
        if (error instanceof ThreadRequestError && (error.status === 403 || error.status === 404)) {
          await load();
        }
        return false;
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
    lastUpdated,
    canPost: adapter.canPost && serverCanPost,
    post,
    retry,
    discard,
    edit,
    remove,
    react,
    writeError,
    clearWriteError,
    refresh,
  };
}
