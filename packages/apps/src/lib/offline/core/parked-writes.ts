import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";

/**
 * A queued write the server refused for good because its container (a task
 * list, later a notebook, address book or calendar: #1565) is gone for this
 * person or view-only now. Instead of dropping it, the app parks it here until
 * the person picks a container to keep it in, or discards it. A parked write
 * is no longer in the outbox: it is not retried and is not a sync conflict.
 *
 * - `create`: an item added offline that never reached the server.
 * - `edit`: offline changes to an existing item; rescued as a new item.
 */
export type ParkedWrite<T = unknown> = {
  /** `domain:entityId`, so parking the same item twice keeps one entry. */
  id: string;
  domain: string;
  entityId: string;
  kind: "create" | "edit";
  /** `gone`: deleted or no longer shared. `readOnly`: still there, view-only now. */
  reason: "gone" | "readOnly";
  containerId: string;
  containerName: string;
  title: string;
  /** The local copy to rescue, as the app stores it. */
  item: T;
  parkedAt: number;
};

export type ParkedWriteInput<T> = Omit<ParkedWrite<T>, "id" | "parkedAt">;

const metaKey = (domain: string) => `parked-writes:${domain}`;

type ParkedWritesChanged = { username: string; domain: string };

const topic = crossTabTopic(
  "wgw-parked-writes",
  (value): value is ParkedWritesChanged =>
    typeof (value as ParkedWritesChanged | null)?.domain === "string" &&
    typeof (value as ParkedWritesChanged).username === "string",
);

/** Hear when parked writes change in any tab of this browser. */
export function subscribeParkedWrites(
  username: string,
  domain: string,
  onChange: () => void,
): () => void {
  return topic.subscribe((message) => {
    if (message.username === username && message.domain === domain) onChange();
  });
}

function parse<T>(value: string | undefined): ParkedWrite<T>[] {
  if (!value) return [];
  try {
    const rows = JSON.parse(value) as unknown;
    return Array.isArray(rows) ? (rows as ParkedWrite<T>[]) : [];
  } catch {
    return [];
  }
}

/**
 * Read, change and write the domain's parked writes in one IndexedDB
 * transaction, so two tabs never both take the same write.
 */
async function update<T, R>(
  username: string,
  domain: string,
  change: (rows: ParkedWrite<T>[]) => { rows: ParkedWrite<T>[]; result: R },
): Promise<R> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const key = metaKey(domain);
  const result = await db.transaction("rw", db.meta, async () => {
    const next = change(parse<T>((await db.meta.get(key))?.value));
    if (next.rows.length > 0) await db.meta.put({ key, value: JSON.stringify(next.rows) });
    else await db.meta.delete(key);
    return next.result;
  });
  topic.publish({ username, domain });
  return result;
}

export async function listParkedWrites<T>(
  username: string,
  domain: string,
): Promise<ParkedWrite<T>[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return parse<T>((await db.meta.get(metaKey(domain)))?.value);
}

/** Park writes; an item parked again replaces its earlier entry. */
export function parkWrites<T>(
  username: string,
  domain: string,
  writes: ParkedWriteInput<T>[],
): Promise<void> {
  return update<T, void>(username, domain, (rows) => {
    const parked = writes.map((write) => ({
      ...write,
      id: `${write.domain}:${write.entityId}`,
      parkedAt: Date.now(),
    }));
    const ids = new Set(parked.map((write) => write.id));
    return { rows: [...rows.filter((row) => !ids.has(row.id)), ...parked], result: undefined };
  });
}

/**
 * Take writes out for a rescue or a discard. Only the writes still parked come
 * back: one another tab took already are gone, so nothing is rescued twice.
 */
export function takeParkedWrites<T>(
  username: string,
  domain: string,
  ids: string[],
): Promise<ParkedWrite<T>[]> {
  const wanted = new Set(ids);
  return update<T, ParkedWrite<T>[]>(username, domain, (rows) => ({
    rows: rows.filter((row) => !wanted.has(row.id)),
    result: rows.filter((row) => wanted.has(row.id)),
  }));
}
