import type { Note } from "@/lib/models/note";
import { formatListDateTime, parseTimestamp } from "@/lib/datetime/format-list-date";

export { parseTimestamp as parseNoteTimestamp };

/** Newest-edited first; invalid dates sort last; ties break on id descending. */
export function compareNotesDesc(
  a: Pick<Note, "id" | "date">,
  b: Pick<Note, "id" | "date">,
): number {
  const da = parseTimestamp(a.date);
  const db = parseTimestamp(b.date);
  const aValid = da !== null;
  const bValid = db !== null;
  if (aValid && bValid && da !== db) return db - da;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return b.id.localeCompare(a.id);
}

export function formatNoteDateForList(raw: string): string {
  return formatListDateTime(raw);
}

export function formatNoteDateForDetail(raw: string): string {
  const ts = parseTimestamp(raw);
  if (ts === null) return raw;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** Compact list-style stamp for the detail footer. Empty when no real timestamp. */
export function formatNoteLastEdited(note: Pick<Note, "date" | "updatedAt">): string {
  const raw = note.date !== "—" && note.date !== "" ? note.date : (note.updatedAt ?? "");
  if (!raw || raw === "—") return "";
  return formatListDateTime(raw);
}
