import { holdCrossTabLockIfFree, withCrossTabLockIfFree } from "@/lib/offline/core/cross-tab-lock";
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

/**
 * Writes a tab took out of the park to rescue them (#1825). They stay on disk
 * under the claim until each one is created, so a reload or a closed tab in the
 * middle of the rescue cannot lose them: the next load puts them back.
 */
type Claim<T> = { claim: string; writes: ParkedWrite<T>[] };

const claimsKey = (domain: string) => `parked-writes-claims:${domain}`;
const claimLockName = (username: string, domain: string, claim: string) =>
  `wgw-parked-claim:${domain}:${username}:${claim}`;

function parseClaims<T>(value: string | undefined): Claim<T>[] {
  if (!value) return [];
  try {
    const claims = JSON.parse(value) as unknown;
    return Array.isArray(claims) ? (claims as Claim<T>[]) : [];
  } catch {
    return [];
  }
}

/** Change the park and the claims of a domain in one transaction. */
async function updateWithClaims<T, R>(
  username: string,
  domain: string,
  change: (state: { rows: ParkedWrite<T>[]; claims: Claim<T>[] }) => {
    rows: ParkedWrite<T>[];
    claims: Claim<T>[];
    result: R;
  },
): Promise<R> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const result = await db.transaction("rw", db.meta, async () => {
    const next = change({
      rows: parse<T>((await db.meta.get(metaKey(domain)))?.value),
      claims: parseClaims<T>((await db.meta.get(claimsKey(domain)))?.value),
    });
    const put = async (key: string, list: unknown[]) =>
      list.length > 0
        ? void (await db.meta.put({ key, value: JSON.stringify(list) }))
        : db.meta.delete(key);
    await put(metaKey(domain), next.rows);
    await put(claimsKey(domain), next.claims);
    return next.result;
  });
  topic.publish({ username, domain });
  return result;
}

export type ParkedClaim<T> = {
  writes: ParkedWrite<T>[];
  /** These writes are created (or parked again): they no longer need the claim. */
  settle: (ids: string[]) => Promise<void>;
  /** Let the claim go; whatever was not settled is put back by the next load. */
  release: () => void;
};

/**
 * Like `takeParkedWrites`, but the writes are kept under a claim until `settle`
 * clears them. A Web Lock marks the claim as alive while this tab works on it.
 */
export async function claimParkedWrites<T>(
  username: string,
  domain: string,
  ids: string[],
): Promise<ParkedClaim<T>> {
  const claim = crypto.randomUUID();
  const release =
    (await holdCrossTabLockIfFree(claimLockName(username, domain, claim))) ?? (() => {});
  const wanted = new Set(ids);
  const writes = await updateWithClaims<T, ParkedWrite<T>[]>(username, domain, (state) => {
    const taken = state.rows.filter((row) => wanted.has(row.id));
    return {
      rows: state.rows.filter((row) => !wanted.has(row.id)),
      claims: taken.length > 0 ? [...state.claims, { claim, writes: taken }] : state.claims,
      result: taken,
    };
  }).catch((error: unknown) => {
    release();
    throw error;
  });
  const settle = (settled: string[]) => {
    const done = new Set(settled);
    return updateWithClaims<T, void>(username, domain, (state) => ({
      rows: state.rows,
      claims: state.claims
        .map((entry) =>
          entry.claim === claim
            ? { ...entry, writes: entry.writes.filter((write) => !done.has(write.id)) }
            : entry,
        )
        .filter((entry) => entry.writes.length > 0),
      result: undefined,
    }));
  };
  return { writes, settle, release };
}

/**
 * Put writes back that a tab claimed and never settled (it was closed or
 * reloaded mid-rescue). Claims whose tab still holds its lock are left alone.
 */
export async function restoreAbandonedClaims(username: string, domain: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const claims = parseClaims<unknown>((await db.meta.get(claimsKey(domain)))?.value);
  for (const { claim } of claims) {
    await withCrossTabLockIfFree(claimLockName(username, domain, claim), () =>
      updateWithClaims<unknown, void>(username, domain, (state) => {
        const abandoned = state.claims.find((entry) => entry.claim === claim);
        if (!abandoned) return { ...state, result: undefined };
        const ids = new Set(abandoned.writes.map((write) => write.id));
        return {
          rows: [...state.rows.filter((row) => !ids.has(row.id)), ...abandoned.writes],
          claims: state.claims.filter((entry) => entry.claim !== claim),
          result: undefined,
        };
      }),
    );
  }
}
