import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { cacheChangedTopic } from "@/lib/offline/core/cache-changed-topic";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

const DOCS_STARRED_PATHS_META_KEY = "docs.starredPaths";

/** Tells every tab, this one included, that the star set changed (Drive and Docs write it). */
const starsTopic = cacheChangedTopic("starred-paths");

/** Hear a change of the star set for `username`, from any tab, this one included. */
export const subscribeStarredPathsChanged = starsTopic.subscribe;

/** Store the set and tell open views, only when it differs from what was stored. */
async function storeStarredPathSet(
  username: string,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): Promise<void> {
  const same = before.size === after.size && [...after].every((path) => before.has(path));
  await writeMeta(username, DOCS_STARRED_PATHS_META_KEY, JSON.stringify(Array.from(after)));
  // Only a real change notifies: a refresh that stores the same set must not make views re-read.
  if (!same) starsTopic.notifyAllTabs(username);
}

function normalizeStarPath(path: string): string {
  return normalizeApiVirtualPath(path);
}

async function readStarredPathSet(username: string): Promise<Set<string>> {
  const raw = await readMeta(username, DOCS_STARRED_PATHS_META_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeStarPath(entry)),
    );
  } catch {
    return new Set();
  }
}

/** Read cached starred drive paths for offline Docs home. */
export async function readDocsStarredPaths(username: string): Promise<string[]> {
  return Array.from(await readStarredPathSet(username));
}

/** Replace the cached starred path list (e.g. after a successful online fetch). */
export async function writeDocsStarredPaths(username: string, paths: string[]): Promise<void> {
  const normalized = new Set(
    paths.map((path) => normalizeStarPath(path)).filter((path) => path.length > 1),
  );
  await storeStarredPathSet(username, await readStarredPathSet(username), normalized);
}

/** Apply a star toggle to the cached starred path list. */
export async function applyDocsStarToggle(
  username: string,
  path: string,
  starred: boolean,
): Promise<void> {
  const normalized = normalizeStarPath(path);
  const before = await readStarredPathSet(username);
  const paths = new Set(before);
  if (starred) paths.add(normalized);
  else paths.delete(normalized);
  await storeStarredPathSet(username, before, paths);
}
