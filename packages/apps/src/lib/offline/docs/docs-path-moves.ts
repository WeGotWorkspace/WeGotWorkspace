import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { moveDocsCollabPathDatabasesInBatch } from "@/lib/collab/docs-collab-path-batch";
import { moveDocsCollabPathDatabases } from "@/lib/collab/docs-collab-persistence";

/** One path change: a Doc, or the folder that holds it, from `from` to `to`. */
export type DocsPathMove = { from: string; to: string };

/**
 * Docs (or the folders that hold them) now live at other paths (#1563). Every
 * tab of this browser hears it, this one included, so an editor that has an
 * old path open follows the file instead of saving to a path that is gone.
 * One message carries every move of one sync, read against the paths as they
 * were before it (#2063 C4): a swap moves each editor once, to its own Doc.
 */
export type DocsPathMoved = {
  type: "docs-path-moved";
  username: string;
  moves: DocsPathMove[];
};

function isPathMove(value: unknown): value is DocsPathMove {
  const move = value as DocsPathMove | null;
  return typeof move?.from === "string" && typeof move.to === "string";
}

const topic = crossTabTopic<DocsPathMoved>(
  "wgw.docs.path-moved",
  (value): value is DocsPathMoved => {
    const message = value as DocsPathMoved | null;
    return (
      message?.type === "docs-path-moved" &&
      typeof message.username === "string" &&
      Array.isArray(message.moves) &&
      message.moves.every(isPathMove)
    );
  },
);

function pathKey(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** The real moves of a batch, keys without slashes; the last move of a `from` wins. */
function normalizeMoves(moves: readonly DocsPathMove[]): DocsPathMove[] {
  const byFrom = new Map<string, string>();
  for (const move of moves) {
    const from = pathKey(move.from);
    const to = pathKey(move.to);
    if (from && to && from !== to) byFrom.set(from, to);
  }
  return [...byFrom].map(([from, to]) => ({ from, to }));
}

/** Tell every tab, this one included, about one batch of moves. */
export function publishDocsPathMoves(username: string, moves: readonly DocsPathMove[]): void {
  const batch = normalizeMoves(moves);
  if (!username || batch.length === 0) return;
  topic.publish({ type: "docs-path-moved", username, moves: batch });
}

/** Tell every tab, this one included, that `from` (a file or a folder) is now `to`. */
export function publishDocsPathMoved(username: string, from: string, to: string): void {
  publishDocsPathMoves(username, [{ from, to }]);
}

/**
 * The Docs a sync relocated (#2063 C7), as its final map: one move per file,
 * from its path before the sync to its final path. The text this device keeps
 * in path-keyed databases follows that map (each read once, written only at
 * its own final path, never merged into what was there), then every tab hears
 * the batch once, so each open editor follows its own Doc once. A swap never
 * merges one Doc's text into the other's or sends an editor to the wrong Doc.
 */
export async function moveDocsPaths(
  username: string,
  moves: readonly DocsPathMove[],
): Promise<void> {
  const batch = normalizeMoves(moves);
  if (!username || batch.length === 0) return;
  try {
    await moveDocsCollabPathDatabasesInBatch(batch);
  } catch (error) {
    console.warn("[docs] could not move local text with the document", error);
  }
  publishDocsPathMoves(username, batch);
}

/**
 * The person moved one Doc or folder: the text this device keeps under the
 * old path (and, for a folder, under it) moves along, then every tab hears it.
 */
export async function moveDocsPath(username: string, from: string, to: string): Promise<void> {
  const batch = normalizeMoves([{ from, to }]);
  if (!username || batch.length === 0) return;
  try {
    await moveDocsCollabPathDatabases(batch[0]!.from, batch[0]!.to);
  } catch (error) {
    console.warn("[docs] could not move local text with the document", error);
  }
  publishDocsPathMoves(username, batch);
}

/** Hear each batch of path moves for `username` from any tab, this one included. */
export function subscribeDocsPathMoved(
  username: string,
  onMoved: (moves: readonly DocsPathMove[]) => void,
): () => void {
  if (!username) return () => undefined;
  return topic.subscribe((message) => {
    if (message.username === username) onMoved(message.moves);
  });
}

/**
 * Where `path` lives after `from` moved to `to`: the new path for the file
 * itself or for a path under a moved folder, else null. No leading slash.
 */
export function docsPathAfterMove(path: string, from: string, to: string): string | null {
  const key = pathKey(path);
  const fromKey = pathKey(from);
  if (!key || !fromKey) return null;
  if (key === fromKey) return pathKey(to);
  if (key.startsWith(`${fromKey}/`)) return `${pathKey(to)}${key.slice(fromKey.length)}`;
  return null;
}

/**
 * Where `path` lives after a batch of moves, each read against the paths as
 * they were before the batch: the longest matching `from` wins, and it is
 * applied once. Null when no move touches `path`.
 */
export function docsPathAfterMoves(path: string, moves: readonly DocsPathMove[]): string | null {
  const ordered = [...moves].sort((a, b) => pathKey(b.from).length - pathKey(a.from).length);
  for (const move of ordered) {
    const next = docsPathAfterMove(path, move.from, move.to);
    if (next !== null) return next;
  }
  return null;
}
