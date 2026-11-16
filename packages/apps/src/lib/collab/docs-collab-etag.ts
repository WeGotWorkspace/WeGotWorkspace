/**
 * Per-room view of the server's Yjs sidecar entity tag (contract C7).
 *
 * Three states matter on a save: a known ETag sends `If-Match`, a room known to
 * have no sidecar sends `If-None-Match: *`, and a room nobody has loaded yet
 * sends no precondition at all so the server keeps accepting old clients.
 */
export type CollabSidecarPrecondition =
  { name: "If-Match"; value: string } | { name: "If-None-Match"; value: "*" } | null;

/** `null` records "the server has no sidecar for this room". */
const sidecarEtags = new Map<string, string | null>();

export function rememberSidecarEtag(room: string, etag: string | null): void {
  if (!room) return;
  sidecarEtags.set(room, etag);
}

export function forgetSidecarEtag(room: string): void {
  sidecarEtags.delete(room);
}

export function sidecarPrecondition(room: string): CollabSidecarPrecondition {
  if (!room || !sidecarEtags.has(room)) return null;
  const etag = sidecarEtags.get(room) ?? null;
  return etag === null ? { name: "If-None-Match", value: "*" } : { name: "If-Match", value: etag };
}

/** Test helper to clear the per-room ETag view. */
export function resetSidecarEtagsForTests(): void {
  sidecarEtags.clear();
}
