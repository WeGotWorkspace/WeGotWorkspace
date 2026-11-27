/**
 * Pure row rules of the local file tree (#2063): which paths are list rows,
 * the indexed `ext` column, and the `area` a row belongs to.
 */

/** Which part of the tree a row belongs to. Decided after a complete pass. */
export type DriveEntryArea = "home" | "group" | "share" | "trash";

const TRASH_SEGMENT = ".Trash";

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * True when a path is not a list row: any segment starts with `.`, except
 * `.Trash`. `.notes`, `.attachments` and everything inside them are file-indexed
 * on the server but never stored as rows.
 */
export function isHiddenTreePath(path: string): boolean {
  return segments(path).some((segment) => segment.startsWith(".") && segment !== TRASH_SEGMENT);
}

/** True when a path is `.Trash` or inside it. */
export function isTrashTreePath(path: string): boolean {
  return segments(path).includes(TRASH_SEGMENT);
}

/** True for an item in Trash itself, not the `.Trash` folder and not a row inside a trashed folder. */
export function isTrashItemPath(path: string): boolean {
  const parts = segments(path);
  return parts.length >= 2 && parts[parts.length - 2] === TRASH_SEGMENT;
}

/** True for a name a folder listing hides (every dot name, `.Trash` included). */
export function isDotName(name: string): boolean {
  return name.trim().startsWith(".");
}

/** Lower-case extension of a file name without the dot; `""` when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * `area` from a row's own path alone. Exact for rows the per-folder crawl
 * wrote (home and team drives only; it never stored share roots), so it is the
 * backfill rule. A full tree pass decides `area` from the parent chain instead.
 */
export function areaFromCrawledPath(path: string): DriveEntryArea {
  if (isTrashTreePath(path)) return "trash";
  return segments(path)[0] === "groups" ? "group" : "home";
}

/**
 * `area` of a node from its root: an account root of the person (home or team
 * drive) or a share root (a node whose parent is not in the tree). Trash wins.
 */
export function areaForRoot(
  path: string,
  root: { kind: "account"; path: string } | { kind: "share" },
): DriveEntryArea {
  if (isTrashTreePath(path)) return "trash";
  if (root.kind === "share") return "share";
  return segments(root.path)[0] === "groups" ? "group" : "home";
}
