/**
 * A list of inbox row ids this browser remembers in `localStorage`, read by
 * every tab and kept across reloads (local-ack #1826, toast decisions #1669).
 *
 * Notification ids are server ULIDs that belong to one user, so one list
 * serves every account on the device. Keys under `wgw.offline.` are wiped on
 * sign-out with the rest of the device's account data.
 */
export type IdListStore = {
  read(): ReadonlySet<string>;
  /** Remember `ids`; the oldest drop off past the cap. */
  add(ids: readonly string[]): void;
};

export type IdStorage = Pick<Storage, "getItem" | "setItem">;

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
 * so one tab still sees each id once.
 */
export function createIdListStore(
  storage: IdStorage | null,
  key: string,
  maxIds: number,
): IdListStore {
  /** What this tab last wrote; still read when a later write to storage failed. */
  let memory: string[] = [];

  function readStored(): string[] {
    if (!storage) return [];
    try {
      return parseIds(storage.getItem(key)) ?? [];
    } catch {
      return [];
    }
  }

  function load(): string[] {
    const stored = readStored();
    const inStorage = new Set(stored);
    return [...stored, ...memory.filter((id) => !inStorage.has(id))];
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
        storage.setItem(key, JSON.stringify(memory));
        // Storage is shared between tabs and now holds the list; keeping a copy
        // would put ids another tab trimmed back in as if they were newer.
        memory = [];
      } catch {
        // Quota or private mode: the in-memory list still covers this tab.
      }
    },
  };
}

export function browserStorage(): IdStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
