import { withCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

/** The answer of one GET: `json` only when the server said OK. */
export type AccountRead =
  { ok: true; status: number; json: Record<string, unknown> } | { ok: false; status: number };

/**
 * Safety net, not the freshness rule. A write, a sign-out or a sign-in as
 * another user drops the shared value at once. This only bounds how long a
 * change made elsewhere (an admin turning an app off for this account) can go
 * unseen by a browser that never wrote anything itself.
 */
export const ACCOUNT_READ_MAX_AGE_MS = 5 * 60_000;

const STORAGE_PREFIX = "wgw.account-read.v1.";
const CHANNEL_PREFIX = "wgw.account-read.";

type Stored = { identity: string; at: number; json: Record<string, unknown> };

type Message =
  { type: "set"; identity: string; at: number; json: Record<string, unknown> } | { type: "clear" };

function isMessage(value: unknown): value is Message {
  const type = (value as Message | null)?.type;
  return type === "set" || type === "clear";
}

export type SharedAccountReadOptions = {
  /** Names the stored copy and the cross-tab channel, e.g. `settings-state`. */
  name: string;
  /** One network read. Runs at most once per browser while the shared value is fresh. */
  load: () => Promise<AccountRead>;
  /**
   * Whose answer this is (the signed-in username). `null` when unknown: the
   * read is then only shared while in flight, never kept.
   */
  identity: () => string | null;
  maxAgeMs?: number;
  now?: () => number;
};

export type SharedAccountRead = {
  /** The shared answer: from memory, another tab's copy, or one network read. */
  read: () => Promise<AccountRead>;
  /** Read again from the server (the account changed in a way the client cannot see). */
  readFresh: () => Promise<AccountRead>;
  /** A write returned the new value: every open tab uses it from now on. */
  set: (json: Record<string, unknown>) => void;
  /** Drop the shared value in every tab; the next read asks the server. */
  invalidate: () => void;
  /** Hear a value another tab (or this one) just set. */
  subscribe: (listener: (json: Record<string, unknown>) => void) => () => void;
  /** Forget everything held in memory and storage. For unit tests only. */
  resetForTests: () => void;
};

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * One request per browser for an account-level GET every app needs
 * (`/settings/state`, `/me`): a request already in flight is joined, a Web
 * Lock stops a second tab from asking at the same moment, and the answer is
 * kept (memory + localStorage, keyed by who is signed in) until a write sets
 * it, something invalidates it, or it ages out.
 */
export function createSharedAccountRead(options: SharedAccountReadOptions): SharedAccountRead {
  const maxAge = options.maxAgeMs ?? ACCOUNT_READ_MAX_AGE_MS;
  const now = options.now ?? Date.now;
  const storageKey = `${STORAGE_PREFIX}${options.name}`;
  const topic = crossTabTopic<Message>(`${CHANNEL_PREFIX}${options.name}`, isMessage);
  const listeners = new Set<(json: Record<string, unknown>) => void>();

  let memory: Stored | null = null;
  let inflight: { identity: string | null; promise: Promise<AccountRead> } | null = null;
  /** Bumped by every set/invalidate so a read that started earlier cannot overwrite it. */
  let generation = 0;
  let subscribed = false;

  const fresh = (entry: Stored | null | undefined, identity: string | null): entry is Stored =>
    !!entry && identity !== null && entry.identity === identity && now() - entry.at < maxAge;

  const readStored = (): Stored | null => {
    try {
      const raw = storage()?.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Stored> | null;
      if (
        parsed &&
        typeof parsed.identity === "string" &&
        typeof parsed.at === "number" &&
        parsed.json &&
        typeof parsed.json === "object"
      ) {
        return parsed as Stored;
      }
    } catch {
      // Unreadable copy: ask the server.
    }
    return null;
  };

  const writeStored = (entry: Stored | null) => {
    try {
      if (entry) storage()?.setItem(storageKey, JSON.stringify(entry));
      else storage()?.removeItem(storageKey);
    } catch {
      // Storage full or blocked: this tab still shares through memory.
    }
  };

  const adopt = (message: Message) => {
    generation += 1;
    if (message.type === "clear") {
      memory = null;
      return;
    }
    memory = { identity: message.identity, at: message.at, json: message.json };
    for (const listener of listeners) listener(message.json);
  };

  const ensureSubscribed = () => {
    if (subscribed) return;
    subscribed = true;
    // Other tabs' writes arrive here; this tab applies its own directly.
    topic.subscribe(adopt);
  };

  const store = (identity: string, json: Record<string, unknown>) => {
    const entry: Stored = { identity, at: now(), json };
    memory = entry;
    writeStored(entry);
    return entry;
  };

  const network = async (identity: string | null): Promise<AccountRead> => {
    const startedAt = generation;
    const load = async (): Promise<AccountRead> => {
      // A tab that waited for the lock finds the holder's answer here.
      if (identity !== null) {
        const stored = readStored();
        if (fresh(stored, identity)) {
          memory = stored;
          return { ok: true, status: 200, json: stored.json };
        }
      }
      const result = await options.load();
      if (result.ok && identity !== null && startedAt === generation) {
        store(identity, result.json);
      }
      return result;
    };
    return identity === null ? load() : withCrossTabLock(`wgw-account-read-${options.name}`, load);
  };

  const start = (identity: string | null): Promise<AccountRead> => {
    if (inflight && inflight.identity === identity) return inflight.promise;
    const promise = network(identity);
    const entry = { identity, promise };
    inflight = entry;
    const clear = () => {
      if (inflight === entry) inflight = null;
    };
    promise.then(clear, clear);
    return promise;
  };

  const invalidate = () => {
    ensureSubscribed();
    adopt({ type: "clear" });
    writeStored(null);
    topic.publish({ type: "clear" }, { otherTabsOnly: true });
  };

  return {
    read() {
      ensureSubscribed();
      const identity = options.identity();
      if (fresh(memory, identity))
        return Promise.resolve({ ok: true, status: 200, json: memory.json });
      return start(identity);
    },
    readFresh() {
      invalidate();
      inflight = null;
      return start(options.identity());
    },
    set(json) {
      ensureSubscribed();
      const identity = options.identity();
      if (identity === null) return;
      const entry = store(identity, json);
      const message: Message = { type: "set", identity, at: entry.at, json };
      adopt(message);
      topic.publish(message, { otherTabsOnly: true });
    },
    invalidate,
    subscribe(listener) {
      ensureSubscribed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resetForTests() {
      memory = null;
      inflight = null;
      generation += 1;
      writeStored(null);
    },
  };
}
