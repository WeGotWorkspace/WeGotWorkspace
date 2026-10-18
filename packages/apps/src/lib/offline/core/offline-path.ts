/** Path key shared by drive entries, docs availability, and collab room names. */
export function normalizeOfflinePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}
