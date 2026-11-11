import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

const DOCS_STARRED_PATHS_META_KEY = "docs.starredPaths";

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
  const normalized = Array.from(
    new Set(paths.map((path) => normalizeStarPath(path)).filter((path) => path.length > 1)),
  );
  await writeMeta(username, DOCS_STARRED_PATHS_META_KEY, JSON.stringify(normalized));
}

/** Apply a star toggle to the cached starred path list. */
export async function applyDocsStarToggle(
  username: string,
  path: string,
  starred: boolean,
): Promise<void> {
  const normalized = normalizeStarPath(path);
  const paths = await readStarredPathSet(username);
  if (starred) paths.add(normalized);
  else paths.delete(normalized);
  await writeMeta(username, DOCS_STARRED_PATHS_META_KEY, JSON.stringify(Array.from(paths)));
}
