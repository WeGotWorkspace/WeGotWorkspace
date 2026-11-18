import { ThreadRequestError, type ThreadEntry } from "@/lib/models/thread-types";

/** Why a comment did not land; the panel shows it next to "Not sent". */
export type ThreadSendFailure = "gone" | "forbidden" | "moved" | "invalid" | "network";

export type ThreadViewEntry = ThreadEntry & {
  /** Sent by this tab, not taken by the server yet. */
  pending?: boolean;
  failed?: ThreadSendFailure;
};

export type ThreadStatus = "loading" | "ready" | "gone" | "offline" | "error";

export function failureOf(error: unknown): ThreadSendFailure {
  if (!(error instanceof ThreadRequestError)) return "network";
  if (error.status === 404) return "gone";
  if (error.status === 403) return "forbidden";
  if (error.status === 409 && error.code === "subject_moved") return "moved";
  return "invalid";
}

function byTime(a: ThreadEntry, b: ThreadEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Comments in time order with their replies; activity entries left out (2026-11-18). */
export function groupThread(entries: Map<string, ThreadViewEntry>): {
  roots: { entry: ThreadViewEntry; replies: ThreadViewEntry[] }[];
  count: number;
} {
  const visible = [...entries.values()].filter((entry) => entry.kind !== "activity").sort(byTime);
  const repliesOf = new Map<string, ThreadViewEntry[]>();
  for (const entry of visible) {
    if (entry.kind === "reply" && entry.parentId) {
      repliesOf.set(entry.parentId, [...(repliesOf.get(entry.parentId) ?? []), entry]);
    }
  }
  const roots = visible
    .filter((entry) => entry.kind === "comment")
    .map((entry) => ({ entry, replies: repliesOf.get(entry.id) ?? [] }));
  return { roots, count: visible.filter((entry) => !entry.deletedAt).length };
}
