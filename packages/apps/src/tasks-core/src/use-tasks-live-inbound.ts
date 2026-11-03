import { useEffect, useRef } from "react";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks-bootstrap-sync";
import { syncTasksInbound, TASKS_INBOUND_POLL_MS } from "@/lib/offline/tasks-inbound-sync";
import { readTasksChangesState } from "@/lib/offline/tasks-offline-store";

/** While push is connected the poll only backs it up. */
export const TASKS_INBOUND_PUSH_POLL_MS = 60_000;

const PUSH_TYPES = ["Task", "TaskList"] as const;
const NO_TYPES: readonly string[] = [];

/**
 * One pull, and a repaint of every tab when it changed something. Resolves
 * whether the cache is now current: false when the pull failed, or when
 * another tab held the outbox lock (its pull or flush lands; the next push
 * compares again).
 */
async function pullTasks(username: string, onChanged: () => Promise<void>): Promise<boolean> {
  try {
    const result = await syncTasksInbound(username);
    if (!result) return false;
    if (result.changed) {
      // The token is shared: the other tabs' next pull sees no change.
      notifyTasksBootstrapUpdated(username);
      await onChanged();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Push entry point for Tasks (#1665). The server's `Task` and `TaskList`
 * states are the REST task-list changes state this cache stores, so a pushed
 * state equal to the stored one needs no pull.
 */
export async function syncTasksIfStale(
  username: string,
  states: Record<string, string>,
  onChanged: () => Promise<void>,
): Promise<boolean> {
  const pushed = states.Task ?? states.TaskList;
  if (pushed === undefined) return true;
  if ((await readTasksChangesState(username)) === pushed) return true;
  return pullTasks(username, onChanged);
}

type UseTasksLiveInboundArgs = {
  /** Account of the offline cache; null until the bootstrap knows it. */
  username: string | null;
  /** Online, bootstrapped and on the live API: the inbound sync may run. */
  enabled: boolean;
  /** Re-read the cache into the list after a pull changed it. */
  patchFromCache: () => Promise<void>;
};

/**
 * Live inbound Tasks sync: a push for `Task` or `TaskList` pulls the task
 * list changes right away; the poll backs it up every 10 s, or every 60 s
 * while push is connected.
 */
export function useTasksLiveInbound({
  username,
  enabled,
  patchFromCache,
}: UseTasksLiveInboundArgs): void {
  const latestPatch = useRef(patchFromCache);
  useEffect(() => {
    latestPatch.current = patchFromCache;
  }, [patchFromCache]);
  const pushConnected = useJmapPushConnected();

  useEffect(() => {
    if (!username || !enabled) return;
    const timer = setInterval(
      () => void pullTasks(username, () => latestPatch.current()),
      pushConnected ? TASKS_INBOUND_PUSH_POLL_MS : TASKS_INBOUND_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [enabled, pushConnected, username]);

  useJmapStateChange(username && enabled ? PUSH_TYPES : NO_TYPES, (states) =>
    username ? syncTasksIfStale(username, states, () => latestPatch.current()) : true,
  );
}
