/**
 * The JMAP push event id: `v1;Note=<h>;FileNode=<h>;…`, a list of independent
 * per-type 128-bit hashes (server: `JmapPushEventId`). The client never
 * computes a hash; it only copies them from ids the server sent and rebuilds
 * `Last-Event-ID` from the ones every subscribed app confirmed.
 */

const VERSION = "v1";
const TYPE_PATTERN = /^[A-Za-z]{1,64}$/;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

export type PushHashes = Record<string, string>;

/** Per-type hashes, or null for a missing or malformed id. */
export function parsePushEventId(id: string | null | undefined): PushHashes | null {
  if (!id) return null;
  const [version, ...parts] = id.split(";");
  if (version !== VERSION) return null;
  const hashes: PushHashes = {};
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 0) return null;
    const type = part.slice(0, separator);
    const hash = part.slice(separator + 1);
    if (!TYPE_PATTERN.test(type) || !HASH_PATTERN.test(hash) || type in hashes) return null;
    hashes[type] = hash;
  }
  return hashes;
}

/** A `Last-Event-ID` from confirmed hashes, or null when there are none. */
export function encodePushEventId(hashes: PushHashes): string | null {
  const types = Object.keys(hashes).sort();
  if (types.length === 0) return null;
  return [VERSION, ...types.map((type) => `${type}=${hashes[type]}`)].join(";");
}
