import { normalizeApiVirtualPath } from "@/lib/files/api-path";

/** Drive virtual path for `/files/threads?path=` (leading slash). */
export function docsThreadsPathFromRoom(room: string | undefined | null): string | null {
  const trimmed = room?.trim();
  if (!trimmed) return null;
  return normalizeApiVirtualPath(trimmed);
}
