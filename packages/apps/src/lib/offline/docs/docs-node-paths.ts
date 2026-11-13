import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { rememberOfflineDocsUsername } from "@/lib/offline/core/offline-session";

/**
 * FileNode id ↔ path for Docs this browser opened online (#1751). The Drive
 * cache only learns ids from a FileNode crawl, so a Doc opened from a link may
 * have none there. This map lets `/docs?id=` open offline and keeps the
 * editor's local copy on its id-keyed database.
 */
const META_KEY = "docs:node-paths";
const MAX_ENTRIES = 500;

type NodePaths = Record<string, string>;

async function readMap(username: string): Promise<NodePaths> {
  const raw = await readMeta(username, META_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as NodePaths) : {};
  } catch {
    return {};
  }
}

/**
 * The id now lives at `path`. A path holds one file: the newest claim wins the
 * path → id lookup. Older ids keep the path as their last known one, so a link
 * to a file replaced in place can find what took its path.
 */
export async function recordDocsNodePath(
  username: string,
  nodeId: string,
  path: string,
): Promise<void> {
  const id = nodeId.trim();
  const key = normalizeOfflinePath(path);
  if (!id || !key) return;
  const map = await readMap(username);
  // Re-insert so insertion order stays recency.
  delete map[id];
  map[id] = key;
  // Insertion order is recency: drop the oldest beyond the cap.
  const ids = Object.keys(map);
  for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) delete map[stale];
  await writeMeta(username, META_KEY, JSON.stringify(map));
  // The editor finds this account by the remembered name, also on a first deep link.
  rememberOfflineDocsUsername(username);
}

/** Path (leading slash) last seen for the id, or `undefined`. */
export async function readDocsPathForNodeId(
  username: string,
  nodeId: string,
): Promise<string | undefined> {
  const id = nodeId.trim();
  if (!id) return undefined;
  const path = (await readMap(username))[id];
  return path ? `/${path}` : undefined;
}

/** Id last seen at the path (the newest claim), or `undefined`. */
export async function readDocsNodeIdForPath(
  username: string,
  path: string,
): Promise<string | undefined> {
  const key = normalizeOfflinePath(path);
  if (!key) return undefined;
  const map = await readMap(username);
  return Object.keys(map)
    .reverse()
    .find((id) => map[id] === key);
}
