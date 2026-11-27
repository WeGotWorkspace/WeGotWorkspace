import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
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
 * Docs (or folders) moved: first move the text this device keeps under the
 * old paths, then tell every tab once. Text in a path-keyed database (a Doc
 * opened before its FileNode id was known, or created offline) is otherwise
 * stranded at the old path once the editor follows the file. A batch moves
 * through temporary names first, so a swap never merges one Doc's text into
 * the other's.
 */
export async function moveDocsPaths(
  username: string,
  moves: readonly DocsPathMove[],
): Promise<void> {
  const batch = normalizeMoves(moves);
  if (!username || batch.length === 0) return;
  try {
    if (batch.length === 1) {
      await moveDocsCollabPathDatabases(batch[0]!.from, batch[0]!.to);
    } else {
      const parked = batch.map((move, index) => ({
        ...move,
        via: `.docs-moving/${crypto.randomUUID()}-${index}/${move.from.split("/").pop()}`,
      }));
      for (const move of parked) await moveDocsCollabPathDatabases(move.from, move.via);
      for (const move of parked) await moveDocsCollabPathDatabases(move.via, move.to);
    }
  } catch (error) {
    console.warn("[docs] could not move local text with the document", error);
  }
  publishDocsPathMoves(username, batch);
}

/** {@link moveDocsPaths} for one move. */
export async function moveDocsPath(username: string, from: string, to: string): Promise<void> {
  await moveDocsPaths(username, [{ from, to }]);
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
