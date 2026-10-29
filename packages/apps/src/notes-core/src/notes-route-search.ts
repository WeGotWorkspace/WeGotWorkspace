/**
 * Path-based notes routing utilities.
 *
 * URL structure:
 *   /notes/all
 *   /notes/all/:noteId
 *   /notes/starred
 *   /notes/starred/:noteId
 *   /notes/archive
 *   /notes/archive/:noteId
 *   /notes/shared-with-me          ← back-compat; Decision 16 collection-sidebar is the product path
 *   /notes/shared-with-me/:noteId
 *   /notes/shared-nb/:sharedNbSlug
 *   /notes/shared-nb/:sharedNbSlug/:noteId
 *   /notes/tags/:tagSlug
 *   /notes/tags/:tagSlug/:noteId
 *   /notes/notebooks/:notebookId
 *   /notes/notebooks/:notebookId/:noteId
 *
 * Notebook URLs use the REST CalDAV collection id, never the display name, so a
 * notebook named "Starred" cannot take over `/notes/starred`.
 */

/** First-path-segment views that must never be treated as notebook ids. */
export const NOTES_RESERVED_VIEW_SEGMENTS = [
  "all",
  "starred",
  "archive",
  "archived",
  "inbox",
  "shared-with-me",
] as const;

const NOTES_RESERVED_VIEW_ALIASES: Record<string, string> = {
  archived: "archive",
};

export type NotesRouteParams = {
  tagSlug?: string;
  notebookId?: string;
  sharedNbSlug?: string;
  noteId?: string;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Derive the controller `view` string from the matched path and params.
 *
 * Slugs come from the path first, like Tasks: while the router moves to a new
 * route, `pathname` is already new but `params` can still belong to the old
 * route (#1752). A path slug is encoded twice (`notesNavigateTarget` plus the
 * router), so it is decoded twice, the same as a router param plus our decode.
 */
export function notesViewFromLocation(pathname: string, params: NotesRouteParams): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "notes") return "all";

  const segment = parts[1] ? decodeURIComponent(parts[1]) : "all";
  if ((NOTES_RESERVED_VIEW_SEGMENTS as readonly string[]).includes(segment)) {
    if (segment === "inbox") return "all";
    return NOTES_RESERVED_VIEW_ALIASES[segment] ?? segment;
  }
  const slug = parts[2] ? safeDecode(parts[2]) : undefined;
  const sharedNbSlug = segment === "shared-nb" ? (slug ?? params.sharedNbSlug) : undefined;
  if (sharedNbSlug) {
    const path = safeDecode(sharedNbSlug);
    return `shared-nb:${path.startsWith("/") ? path : `/${path}`}`;
  }
  const tagSlug = segment === "tags" ? (slug ?? params.tagSlug) : undefined;
  if (tagSlug) {
    return `tag:${safeDecode(tagSlug)}`;
  }
  if (segment === "notebooks") {
    const notebookId = parts[2] ?? params.notebookId;
    if (notebookId) {
      return `nb:${decodeURIComponent(notebookId)}`;
    }
  }
  return "all";
}

/** Active note id from path params; empty string when absent. */
export function notesNoteFromParams(params: NotesRouteParams): string {
  return params.noteId ?? "";
}

export type NotesNavigateTarget = {
  to:
    | "/notes/all"
    | "/notes/all/$noteId"
    | "/notes/starred"
    | "/notes/starred/$noteId"
    | "/notes/archive"
    | "/notes/archive/$noteId"
    | "/notes/shared-with-me"
    | "/notes/shared-with-me/$noteId"
    | "/notes/shared-nb/$sharedNbSlug"
    | "/notes/shared-nb/$sharedNbSlug/$noteId"
    | "/notes/tags/$tagSlug"
    | "/notes/tags/$tagSlug/$noteId"
    | "/notes/notebooks/$notebookId"
    | "/notes/notebooks/$notebookId/$noteId";
  params: Record<string, string>;
};

/** Build a router navigation target from controller view + optional note id. */
export function notesNavigateTarget(view: string, noteId = ""): NotesNavigateTarget {
  if (view === "all") {
    return noteId
      ? { to: "/notes/all/$noteId", params: { noteId } }
      : { to: "/notes/all", params: {} };
  }
  if (view === "starred") {
    return noteId
      ? { to: "/notes/starred/$noteId", params: { noteId } }
      : { to: "/notes/starred", params: {} };
  }
  if (view === "archive") {
    return noteId
      ? { to: "/notes/archive/$noteId", params: { noteId } }
      : { to: "/notes/archive", params: {} };
  }
  if (view === "shared-with-me") {
    return noteId
      ? { to: "/notes/shared-with-me/$noteId", params: { noteId } }
      : { to: "/notes/shared-with-me", params: {} };
  }
  if (view.startsWith("shared-nb:")) {
    const sharedNbSlug = encodeURIComponent(view.slice("shared-nb:".length));
    return noteId
      ? { to: "/notes/shared-nb/$sharedNbSlug/$noteId", params: { sharedNbSlug, noteId } }
      : { to: "/notes/shared-nb/$sharedNbSlug", params: { sharedNbSlug } };
  }
  if (view.startsWith("tag:")) {
    const tagSlug = encodeURIComponent(view.slice(4));
    return noteId
      ? { to: "/notes/tags/$tagSlug/$noteId", params: { tagSlug, noteId } }
      : { to: "/notes/tags/$tagSlug", params: { tagSlug } };
  }
  if (view.startsWith("nb:")) {
    const notebookId = encodeURIComponent(view.slice(3));
    return noteId
      ? { to: "/notes/notebooks/$notebookId/$noteId", params: { notebookId, noteId } }
      : { to: "/notes/notebooks/$notebookId", params: { notebookId } };
  }
  // Unknown view: keep an optional note id so selection never silently drops.
  return noteId
    ? { to: "/notes/all/$noteId", params: { noteId } }
    : { to: "/notes/all", params: {} };
}
