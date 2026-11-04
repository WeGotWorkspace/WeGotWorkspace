import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { moveDocsCollabPathDatabases } from "@/text-editor-core/docs-collab/docs-collab-persistence";

/**
 * A Doc (or the folder that holds it) now lives at another path (#1563). Every
 * tab of this browser hears it, this one included, so an editor that has the
 * old path open follows the file instead of saving to a path that is gone.
 */
export type DocsPathMoved = { type: "docs-path-moved"; username: string; from: string; to: string };

const topic = crossTabTopic<DocsPathMoved>(
  "wgw.docs.path-moved",
  (value): value is DocsPathMoved => {
    const message = value as DocsPathMoved | null;
    return (
      message?.type === "docs-path-moved" &&
      typeof message.username === "string" &&
      typeof message.from === "string" &&
      typeof message.to === "string"
    );
  },
);

function pathKey(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** Tell every tab, this one included, that `from` (a file or a folder) is now `to`. */
export function publishDocsPathMoved(username: string, from: string, to: string): void {
  if (!username || pathKey(from) === pathKey(to)) return;
  topic.publish({ type: "docs-path-moved", username, from: pathKey(from), to: pathKey(to) });
}

/**
 * A Doc (or folder) moved: first move the text this device keeps under the
 * old path, then tell every tab. Text in a path-keyed database (a Doc opened
 * before its FileNode id was known, or created offline) is otherwise
 * stranded at the old path once the editor follows the file.
 */
export async function moveDocsPath(username: string, from: string, to: string): Promise<void> {
  if (!username || pathKey(from) === pathKey(to)) return;
  try {
    await moveDocsCollabPathDatabases(pathKey(from), pathKey(to));
  } catch (error) {
    console.warn("[docs] could not move local text with the document", error);
  }
  publishDocsPathMoved(username, from, to);
}

/** Hear path moves for `username` from any tab, this one included. */
export function subscribeDocsPathMoved(
  username: string,
  onMoved: (from: string, to: string) => void,
): () => void {
  if (!username) return () => undefined;
  return topic.subscribe((message) => {
    if (message.username === username) onMoved(message.from, message.to);
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
