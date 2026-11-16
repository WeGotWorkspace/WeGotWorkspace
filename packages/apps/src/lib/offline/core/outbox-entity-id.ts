import type { OfflineOutboxRow } from "@/lib/offline/core/types";

/**
 * A reader for the entity an outbox row of `domain` targets: the first of
 * `keys` its payload carries (e.g. the server id, then the temp id of a
 * create). Null for a row of another domain or a payload it cannot read.
 */
export function outboxEntityIdReader(
  domain: string,
  keys: readonly string[],
): (row: OfflineOutboxRow) => string | null {
  return (row) => {
    if (row.domain !== domain) return null;
    try {
      const payload = JSON.parse(row.payload) as Record<string, string | null | undefined>;
      for (const key of keys) {
        const id = payload[key];
        if (id !== undefined && id !== null) return id;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/**
 * A local id for an entity created offline, until the server answers with its
 * own: `prefix` plus a random UUID without dashes.
 */
export function createLocalEntityId(prefix = "local-"): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "")}`;
}
