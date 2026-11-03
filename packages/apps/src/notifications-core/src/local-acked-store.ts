/**
 * Inbox rows this browser has already local-acked, kept across reloads so a
 * page load does not ack the whole unread list again (#1826). Every tab of the
 * browser reads the same list.
 *
 * Notification ids are server ULIDs that belong to one user, so one list
 * serves every account on the device. The `wgw.offline.` prefix puts it in the
 * sign-out wipe with the rest of the device's account data.
 */
export const LOCAL_ACKED_STORAGE_KEY = "wgw.offline.notifications.localAcked";

/**
 * The inbox lists at most 100 unread rows; keeping several pages' worth means
 * an old row only comes back for a second ack after hundreds of newer ones.
 */
export const LOCAL_ACKED_MAX_IDS = 500;

export type LocalAckedStore = {
  read(): ReadonlySet<string>;
  /** Remember `ids` as acked; the oldest drop off past the cap. */
  add(ids: readonly string[]): void;
};

type IdStorage = Pick<Storage, "getItem" | "setItem">;

function parseIds(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string" && id !== "");
  } catch {
    return null;
  }
}

/**
 * Without storage (private mode, quota, no window) the list lives in memory,
 * so one tab still acks each row once.
 */
export function createLocalAckedStore(
  storage: IdStorage | null,
  maxIds: number = LOCAL_ACKED_MAX_IDS,
): LocalAckedStore {
  let memory: string[] = [];

  function load(): string[] {
    if (!storage) return memory;
    try {
      return parseIds(storage.getItem(LOCAL_ACKED_STORAGE_KEY)) ?? memory;
    } catch {
      return memory;
    }
  }

  return {
    read() {
      return new Set(load());
    },
    add(ids) {
      if (ids.length === 0) return;
      const fresh = new Set(ids);
      const kept = load().filter((id) => !fresh.has(id));
      memory = [...kept, ...fresh].slice(-maxIds);
      if (!storage) return;
      try {
        storage.setItem(LOCAL_ACKED_STORAGE_KEY, JSON.stringify(memory));
      } catch {
        // Quota or private mode: the in-memory list still covers this tab.
      }
    },
  };
}

function browserStorage(): IdStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function browserLocalAckedStore(): LocalAckedStore {
  return createLocalAckedStore(browserStorage());
}
