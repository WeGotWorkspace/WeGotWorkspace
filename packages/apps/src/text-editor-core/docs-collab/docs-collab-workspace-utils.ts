/** Words in the footer count: whitespace-separated runs. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** The header title when none is given: the last part of the room path. */
export function defaultTitleFromRoom(room: string | undefined): string {
  const normalized = room?.trim().replace(/\/+$/, "");
  if (!normalized) return "document.md";
  const slash = normalized.lastIndexOf("/");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return name || "document.md";
}
