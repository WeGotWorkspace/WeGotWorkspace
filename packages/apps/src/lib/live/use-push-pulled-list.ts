import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ApiError } from "@/lib/api/api-error";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import {
  useJmapPushConnected,
  useJmapStateChange,
  type JmapPushHubLike,
} from "@/lib/api/wgw/use-jmap-state-change";

/**
 * A list that follows the doorbell pattern (#2286, #2298): the list for one
 * scope (a document path, a task, a channel) is fetched once, then pulled
 * through a `/changes` feed whenever the push type rings, and polled only while
 * push is down. Apps declare the client, the push type and the backup poll;
 * everything else lives here. Docs threads use it today.
 */

/** One page of a `/changes` feed, as every WGW list feed returns it. */
export type PushPulledChangesPage = {
  newState: string;
  created: readonly string[];
  updated: readonly string[];
  destroyed: readonly string[];
  hasMoreChanges: boolean;
};

export type PushPulledListClient<T> = {
  list: (scope: string) => Promise<T[]>;
  changes: (scope: string, since: string | null) => Promise<PushPulledChangesPage>;
};

/**
 * Most changes pages one pull walks. Feeds page at 200 rows; a pull that hits
 * this cap answers false, so the push hub offers the state again and the next
 * pull goes on from where this one stopped.
 */
export const PUSH_PULLED_MAX_CHANGE_PAGES = 20;

const NO_PUSH_TYPES: readonly string[] = [];

/** The server no longer knows `since` (expired, or from before a reset). */
export function isCannotCalculateChanges(error: unknown): boolean {
  return error instanceof ApiError && error.code === "cannotCalculateChanges";
}

function hasChanges(page: PushPulledChangesPage): boolean {
  return page.created.length > 0 || page.updated.length > 0 || page.destroyed.length > 0;
}

export type PushPulledRound = {
  /** The state to pull on next: the `newState` of the last page read. */
  state: string;
  /** False when the cap stopped the walk with more pages left. */
  complete: boolean;
};

/**
 * One pull round on `since`, following `hasMoreChanges` page by page: a scope's
 * `since` can fall many pages behind, because writes elsewhere in the same
 * server collection move the feed but do not ring this scope. Reloads once when
 * any page names an item. When the server no longer knows a state
 * (`cannotCalculateChanges`), it starts over with a fresh state and a full
 * reload; the fresh state is taken before the reload, so a change in between
 * shows up again on the next pull. A failed request or reload rejects, so the
 * caller keeps the old state and the next round tries again.
 */
export async function pullChangesPages(
  changes: (since: string | null) => Promise<PushPulledChangesPage>,
  since: string | null,
  reload: () => Promise<void>,
  options: { isCannotCalculate?: (error: unknown) => boolean; label?: string } = {},
): Promise<PushPulledRound> {
  const cannotCalculate = options.isCannotCalculate ?? isCannotCalculateChanges;
  let state = since;
  let changed = false;
  for (let page = 0; page < PUSH_PULLED_MAX_CHANGE_PAGES; page += 1) {
    let next: PushPulledChangesPage;
    try {
      next = await changes(state);
    } catch (error) {
      if (!cannotCalculate(error)) throw error;
      try {
        const fresh = await changes(null);
        await reload();
        return { state: fresh.newState, complete: true };
      } catch (resyncError) {
        // The second failure in a row: report it rather than retry in silence.
        console.warn(
          `[${options.label ?? "push-pulled-list"}] full reload after an expired sync state failed`,
          resyncError,
        );
        throw resyncError;
      }
    }
    if (hasChanges(next)) changed = true;
    state = next.newState;
    if (!next.hasMoreChanges) {
      if (changed) await reload();
      return { state, complete: true };
    }
  }
  if (changed) await reload();
  return { state: state ?? "", complete: false };
}

export type PushPulledList<T> = {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  /** `items` is the server's list for the current client and scope. */
  loaded: boolean;
  reload: () => Promise<void>;
};

export function usePushPulledList<T>({
  client,
  scope,
  live,
  pushType,
  pollMs,
  snapshot = null,
  pushHub = defaultJmapPushHub(),
  isCannotCalculate,
  label,
}: {
  client: PushPulledListClient<T> | null;
  scope: string | null;
  /** Follow other people's changes: on a `pushType` push, or by polling while push is down. */
  live: boolean;
  /** The JMAP push type whose state change means this list may have changed. */
  pushType: string;
  /** Backup poll while the push stream is down. */
  pollMs: number;
  /** A local list (mock data) read instead of the client; never live. Keep it stable. */
  snapshot?: (() => T[]) | null;
  /** The browser's push hub; null (mock data) leaves only the poll. */
  pushHub?: JmapPushHubLike | null;
  /** Keep it stable (a module-level function): a new one re-arms the pull. */
  isCannotCalculate?: (error: unknown) => boolean;
  /** Log prefix for a failed resync. */
  label?: string;
}): PushPulledList<T> {
  const [items, setItems] = useState<T[]>(() => snapshot?.() ?? []);
  const [loadedFor, setLoadedFor] = useState<{
    client: PushPulledListClient<T> | null;
    scope: string | null;
  } | null>(() => (client && snapshot ? { client, scope } : null));
  const sinceRef = useRef<string | null>(null);
  const latestRequest = useRef(0);
  const reload = useCallback(async () => {
    if (!client || !scope) {
      setItems([]);
      setLoadedFor(null);
      return;
    }
    if (snapshot) {
      setItems(snapshot());
      setLoadedFor({ client, scope });
      return;
    }
    const request = ++latestRequest.current;
    const list = await client.list(scope);
    // A slower list for the scope before a move must not overwrite this one.
    if (request !== latestRequest.current) return;
    setItems(list);
    setLoadedFor({ client, scope });
  }, [client, scope, snapshot]);

  const loaded =
    Boolean(client && scope) && loadedFor?.client === client && loadedFor.scope === scope;
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    // A failed list leaves `loaded` false; the next pull retries it.
    reload().catch(() => undefined);
  }, [reload]);

  const following = Boolean(live && client && scope && !snapshot);
  /** One pull round for the current client and scope; resolves false when it failed. */
  const pullRef = useRef<() => Promise<boolean>>(async () => true);

  useEffect(() => {
    if (!following || !client || !scope) {
      pullRef.current = async () => true;
      return;
    }
    let cancelled = false;
    pullRef.current = async () => {
      try {
        // Until a list for this scope has arrived, retry it: an empty changes
        // feed (a scope without items) would never trigger a reload.
        if (!loadedRef.current) {
          await reload();
          return true;
        }
        const pulled = await pullChangesPages(
          (since) => client.changes(scope, since),
          sinceRef.current,
          () => (cancelled ? Promise.resolve() : reload()),
          { isCannotCalculate, label },
        );
        sinceRef.current = pulled.state;
        return pulled.complete;
      } catch {
        // Retried on the next push or poll.
        return false;
      }
    };
    return () => {
      cancelled = true;
    };
  }, [client, following, scope, reload, isCannotCalculate, label]);

  // Push is the doorbell: a state change of `pushType` means something this
  // user can read changed somewhere, so the scope pulls its changes once. A
  // failed or capped pull resolves false, so the hub offers the state again.
  const pushConnected = useJmapPushConnected(pushHub);
  const pushTypes = usePushTypes(following ? pushType : null);
  useJmapStateChange(pushTypes, () => pullRef.current(), pushHub);

  // The interval poll is only the backup while push is down.
  useEffect(() => {
    if (!following || pushConnected) return;
    const id = window.setInterval(() => void pullRef.current(), pollMs);
    return () => window.clearInterval(id);
  }, [client, following, scope, pushConnected, pollMs]);

  return { items, setItems, loaded, reload };
}

/** A stable one-type list, so the push subscription only changes with the type. */
function usePushTypes(pushType: string | null): readonly string[] {
  const [cache] = useState(() => new Map<string, readonly string[]>());
  if (!pushType) return NO_PUSH_TYPES;
  let types = cache.get(pushType);
  if (!types) {
    types = [pushType];
    cache.set(pushType, types);
  }
  return types;
}
