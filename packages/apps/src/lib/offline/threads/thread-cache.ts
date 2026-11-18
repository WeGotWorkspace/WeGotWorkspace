import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import type { ThreadEntry, ThreadSubjectRef } from "@/lib/models/thread-types";

/** The last thread fetched online for one subject (#2173, offline read cache). */
export type CachedThread = {
  entries: ThreadEntry[];
  state: string;
  canPost: boolean;
  /** When it was fetched, epoch ms. */
  fetchedAt: number;
};

const key = (subject: ThreadSubjectRef) =>
  `threads:${encodeURIComponent(subject.type)}:${encodeURIComponent(subject.id)}`;

/** Keeps the thread for offline reading. A cache that cannot be written is not an error. */
export async function writeThreadCache(
  username: string,
  subject: ThreadSubjectRef,
  thread: CachedThread,
): Promise<void> {
  try {
    await writeMeta(username, key(subject), JSON.stringify(thread));
  } catch {
    // Reading online does not depend on the cache.
  }
}

export async function readThreadCache(
  username: string,
  subject: ThreadSubjectRef,
): Promise<CachedThread | null> {
  try {
    const raw = await readMeta(username, key(subject));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedThread>;
    if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== "number") return null;
    return {
      entries: parsed.entries,
      state: String(parsed.state ?? ""),
      canPost: parsed.canPost !== false,
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}
