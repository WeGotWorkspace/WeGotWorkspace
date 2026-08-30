import type { Note } from "@/lib/models/note";

export function parseNoteTimestamp(value: string): number | null {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

/** Newest-edited first; invalid dates sort last; ties break on id descending. */
export function compareNotesDesc(
  a: Pick<Note, "id" | "date">,
  b: Pick<Note, "id" | "date">,
): number {
  const da = parseNoteTimestamp(a.date);
  const db = parseNoteTimestamp(b.date);
  const aValid = da !== null;
  const bValid = db !== null;
  if (aValid && bValid && da !== db) return db - da;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return b.id.localeCompare(a.id);
}

export function formatNoteDateForList(raw: string): string {
  const ts = parseNoteTimestamp(raw);
  if (ts === null) return raw;
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

export function formatNoteDateForDetail(raw: string): string {
  const ts = parseNoteTimestamp(raw);
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
  return formatNoteDateForList(raw);
}
