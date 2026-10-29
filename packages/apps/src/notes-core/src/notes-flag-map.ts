import type { Note } from "@/lib/models/note";

export type NoteFlagMap = Record<string, boolean>;

/** `{ [id]: true }` for every note whose `flag` is set. */
export function noteFlagMap(notes: readonly Note[], flag: "starred" | "archived"): NoteFlagMap {
  const next: NoteFlagMap = {};
  for (const note of notes) {
    if (note[flag]) next[note.id] = true;
  }
  return next;
}

/** True when both maps flag the same ids (a `false` entry counts as unset). */
export function sameNoteFlagMap(a: NoteFlagMap, b: NoteFlagMap): boolean {
  if (a === b) return true;
  let countA = 0;
  for (const id in a) {
    if (!a[id]) continue;
    if (!b[id]) return false;
    countA += 1;
  }
  let countB = 0;
  for (const id in b) {
    if (b[id]) countB += 1;
  }
  return countA === countB;
}

/**
 * State updater that keeps the previous map when the flagged ids did not
 * change, so a body edit does not hand every list row a new `starred` map.
 */
export function syncNoteFlagMap(
  notes: readonly Note[],
  flag: "starred" | "archived",
): (prev: NoteFlagMap) => NoteFlagMap {
  return (prev) => {
    const next = noteFlagMap(notes, flag);
    return sameNoteFlagMap(prev, next) ? prev : next;
  };
}
