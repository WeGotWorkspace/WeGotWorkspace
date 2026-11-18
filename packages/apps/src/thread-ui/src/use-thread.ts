import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadPage,
  type ThreadSubjectAdapter,
} from "@/lib/models/thread-types";
import { readThreadCache, writeThreadCache } from "@/lib/offline/threads/thread-cache";
import {
  groupThread,
  type ThreadSendFailure,
  type ThreadStatus,
  type ThreadViewEntry,
} from "@/thread-ui/src/thread-view";
import { useThreadWrites } from "@/thread-ui/src/use-thread-writes";

/** How often an open thread asks `/changes`, until the `ThreadEntry` push type lands (chunk C). */
export const THREAD_POLL_MS = 15_000;

export type { ThreadSendFailure, ThreadStatus, ThreadViewEntry } from "@/thread-ui/src/thread-view";
export { failureOf } from "@/thread-ui/src/thread-view";

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

  const markLanded = useCallback((entryId: string) => {
    landedAt.current.set(entryId, ++writeSeq.current);
  }, []);
  const upsert = useCallback(
    (entry: ThreadViewEntry) => {
      markLanded(entry.id);
      setEntries((previous) => new Map(previous).set(entry.id, entry));
    },
    [markLanded],
  );

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
        // A clean reload means the thread on screen is the server's: the last write error is moot.
        setWriteError(null);
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
      const current = subjectRef.current;
      // A new adapter object (people loaded, session patched) is still the same subject.
      if (
        signal?.aborted ||
        current.type !== subjectAtStart.type ||
        current.id !== subjectAtStart.id
      )
        return;
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

  const writes = useThreadWrites({
    client,
    subjectRef,
    adapterRef,
    entriesRef,
    setEntries,
    setWriteError,
    markLanded,
    upsert,
    load: () => load(),
  });

  const { roots, count } = useMemo(() => groupThread(entries), [entries]);

  return {
    status,
    roots,
    count,
    lastUpdated,
    canPost: adapter.canPost && serverCanPost,
    ...writes,
    writeError,
    clearWriteError,
    refresh,
  };
}
