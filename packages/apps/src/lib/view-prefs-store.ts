/**
 * Per-device view prefs: one JSON object per app in `localStorage`
 * (`wgw.ui.<app>.viewPrefs`). Each app binds once with its field schema
 * (`notes-view-prefs.ts`, `calendar-view-prefs.ts`, …) instead of copying
 * parse / read / write / patch. See `.agents/skills/workspace/feature-blueprint.md`.
 *
 * Stored keys and shapes are the contract: the schema only names the fields
 * the app already writes. Unknown or invalid fields are dropped on read.
 */

/** Returns the parsed value, or `undefined` to leave the field out. */
export type ViewPrefsField<T> = (value: unknown) => T | undefined;

export type ViewPrefsFields<TPrefs> = {
  [K in keyof TPrefs]-?: ViewPrefsField<NonNullable<TPrefs[K]>>;
};

/** Fields of `TPrefs` that hold an id list (the hidden / known pair). */
type IdListKey<TPrefs> = {
  [K in keyof TPrefs]-?: NonNullable<TPrefs[K]> extends string[] ? K : never;
}[keyof TPrefs];

function parseIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export const viewPrefsField = {
  /** Non-empty string ids; other entries are dropped, a non-array leaves the field out. */
  idList: parseIdList,
  boolean: (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined,
  oneOf<T extends string>(allowed: readonly T[]): ViewPrefsField<T> {
    const set = new Set<string>(allowed);
    return (value) => (typeof value === "string" && set.has(value) ? (value as T) : undefined);
  },
};

/** Shape `useHiddenCollectionIds` persists through (`collection-sidebar`). */
export type HiddenCollectionPersist = {
  read: () => { hiddenIds?: string[]; knownIds?: string[] } | null;
  write: (hiddenIds: ReadonlySet<string>, itemIds: ReadonlyArray<string>) => void;
};

export type ViewPrefsStore<TPrefs extends object> = {
  readonly storageKey: string;
  /** Invalid JSON, a non-object, or no valid field returns null — callers use defaults. */
  parse: (raw: string | null) => TPrefs | null;
  read: () => TPrefs | null;
  /** Replaces the stored object. Storage failures (private mode, quota) are ignored. */
  write: (prefs: TPrefs) => void;
  /** Merges the defined fields of `partial` over what is stored. */
  patch: (partial: TPrefs) => TPrefs;
  /** Called after each write from this tab (not on `storage` events from other tabs). */
  subscribe: (listener: () => void) => () => void;
  /**
   * A `useSyncExternalStore` getter: returns the same reference until the
   * stored JSON changes, so `select` may build new objects.
   */
  snapshot: <T>(select: (prefs: TPrefs | null) => T) => () => T;
  /** Read / write the hidden-ids + known-ids pair for `useHiddenCollectionIds`. */
  hiddenCollection: (
    hiddenKey: IdListKey<TPrefs>,
    knownKey: IdListKey<TPrefs>,
  ) => HiddenCollectionPersist;
};

function windowStorage(): Storage | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  return window.localStorage;
}

function readRaw(storageKey: string): string | null {
  try {
    return windowStorage()?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

function definedEntries<TPrefs extends object>(prefs: TPrefs): Partial<TPrefs> {
  return Object.fromEntries(
    Object.entries(prefs).filter(([, value]) => value !== undefined),
  ) as Partial<TPrefs>;
}

export function createViewPrefsStore<TPrefs extends object>(
  storageKey: string,
  fields: ViewPrefsFields<TPrefs>,
): ViewPrefsStore<TPrefs> {
  const listeners = new Set<() => void>();
  const fieldEntries = Object.entries(fields) as [keyof TPrefs & string, ViewPrefsField<unknown>][];

  const parse = (raw: string | null): TPrefs | null => {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const record = parsed as Record<string, unknown>;
      const prefs: Record<string, unknown> = {};
      for (const [key, parseField] of fieldEntries) {
        const value = parseField(record[key]);
        if (value !== undefined) prefs[key] = value;
      }
      return Object.keys(prefs).length > 0 ? (prefs as TPrefs) : null;
    } catch {
      return null;
    }
  };

  const read = () => parse(readRaw(storageKey));

  const write = (prefs: TPrefs) => {
    const storage = windowStorage();
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      return;
    }
    for (const listener of listeners) listener();
  };

  const patch = (partial: TPrefs): TPrefs => {
    const next = { ...read(), ...definedEntries(partial) } as TPrefs;
    write(next);
    return next;
  };

  return {
    storageKey,
    parse,
    read,
    write,
    patch,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(select) {
      let cachedRaw: string | null | undefined;
      let cached!: ReturnType<typeof select>;
      return () => {
        const raw = readRaw(storageKey);
        if (raw !== cachedRaw) {
          cachedRaw = raw;
          cached = select(parse(raw));
        }
        return cached;
      };
    },
    hiddenCollection(hiddenKey, knownKey) {
      return {
        read: () => {
          const prefs = read() as Record<string, string[] | undefined> | null;
          if (!prefs) return null;
          return { hiddenIds: prefs[hiddenKey as string], knownIds: prefs[knownKey as string] };
        },
        write: (hiddenIds, itemIds) => {
          patch({
            [hiddenKey]: [...hiddenIds],
            [knownKey]: [...new Set(itemIds.filter((id) => id.length > 0))],
          } as TPrefs);
        },
      };
    },
  };
}
