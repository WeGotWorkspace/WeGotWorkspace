import { useEffect, useRef } from "react";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { useInboundSyncSeat } from "@/lib/api/wgw/use-shared-inbound-sync";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { syncTasksInbound, TASKS_INBOUND_POLL_MS } from "@/lib/offline/tasks/tasks-inbound-sync";
import { readTasksChangesState } from "@/lib/offline/tasks/tasks-offline-store";

/** While push is connected the poll only backs it up. */
export const TASKS_INBOUND_PUSH_POLL_MS = 60_000;

/**
 * How long a tab that does not sync waits for the syncing tab to store a
 * pushed state before it pulls itself. Same bound as `SHARED_ROUND_WAIT_MS`.
 */
export const TASKS_SHARED_PULL_WAIT_MS = 5_000;
const SHARED_PULL_CHECK_MS = 500;

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
 * Wait for the syncing tab to store `pushed`. Resolves true once the shared
 * cache holds it, false when this tab should pull itself: the wait ran out
 * (the syncing tab may have loaded after the change and seen nothing to pull),
 * or this tab became the syncing tab.
 */
async function storedByOtherTab(
  username: string,
  pushed: string,
  owns: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + TASKS_SHARED_PULL_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SHARED_PULL_CHECK_MS));
    if (owns()) return false;
    if ((await readTasksChangesState(username)) === pushed) return true;
  }
  return false;
}

/**
 * Push entry point for Tasks (#1665). The server's `Task` and `TaskList`
 * states are the REST task-list changes state this cache stores, so a pushed
 * state equal to the stored one needs no pull.
 *
 * `owns` says whether this tab pulls for the browser. A tab that
 * does not waits for the syncing tab's pull, which repaints it through the
 * cache notice, and pulls itself only when that pull does not come.
 */
export async function syncTasksIfStale(
  username: string,
  states: Record<string, string>,
  onChanged: () => Promise<void>,
  owns: () => boolean = () => true,
): Promise<boolean> {
  const pushed = states.Task ?? states.TaskList;
  if (pushed === undefined) return true;
  if ((await readTasksChangesState(username)) === pushed) return true;
  if (!owns() && (await storedByOtherTab(username, pushed, owns))) return true;
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
 *
 * One tab per browser and account does this. The other tabs repaint
 * from the cache notice of the syncing tab and send no requests of their own;
 * the next one takes over when it closes or is hidden
 * (docs/architecture/jmap-push.md, "One syncing tab per app").
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
  const owns = useInboundSyncSeat("tasks", enabled ? username : null, () => {
    if (username) void pullTasks(username, () => latestPatch.current());
  });

  useEffect(() => {
    if (!username || !enabled) return;
    const timer = setInterval(
      () => {
        if (owns()) void pullTasks(username, () => latestPatch.current());
      },
      pushConnected ? TASKS_INBOUND_PUSH_POLL_MS : TASKS_INBOUND_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [enabled, owns, pushConnected, username]);

  useJmapStateChange(username && enabled ? PUSH_TYPES : NO_TYPES, (states) =>
    username ? syncTasksIfStale(username, states, () => latestPatch.current(), owns) : true,
  );
}
