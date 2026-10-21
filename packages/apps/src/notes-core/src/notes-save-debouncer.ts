import type { Note } from "@/lib/models/note";
import type { NoteMetadataField } from "@/notes-core/src/notes-types";

const FIELD_ORDER: readonly NoteMetadataField[] = ["title", "tags", "starred", "notebook"];

/**
 * Metadata fields an edit changed, compared with the note it started from.
 * A debounced save sends only these, so it cannot resend values that were
 * changed by another write while it waited (a tag added after a keystroke).
 */
export function changedNoteMetadataFields(before: Note, after: Note): NoteMetadataField[] {
  const changed = new Set<NoteMetadataField>();
  if (before.title !== after.title) changed.add("title");
  const tagsMoved = before.tags.some((tag, index) => tag !== after.tags[index]);
  if (before.tags.length !== after.tags.length || tagsMoved) changed.add("tags");
  if (!!before.starred !== !!after.starred) changed.add("starred");
  if (before.notebook !== after.notebook || before.notebookId !== after.notebookId) {
    changed.add("notebook");
  }
  return FIELD_ORDER.filter((field) => changed.has(field));
}

/** `fields` matches `upsertNote` options, so a caller can pass it straight on. */
type PersistFn = (note: Note, save: { fields: NoteMetadataField[] }) => void;

type PendingSave = { note: Note; persist: PersistFn; fields: Set<NoteMetadataField> };

/**
 * Per-note debounced save scheduler.
 *
 * Call `schedule(noteId, note, persist, fields)` on each edit; the actual persist
 * call fires only after `delayMs` of inactivity for that note, with the union of
 * the fields those edits changed.
 * Call `flushAll(persist)` to immediately fire any pending saves (e.g. on unmount).
 */
export function createNoteSaveDebouncer(delayMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, PendingSave>();

  function fieldList(save: PendingSave): NoteMetadataField[] {
    return FIELD_ORDER.filter((field) => save.fields.has(field));
  }

  function arm(noteId: string, delay: number): void {
    const existing = timers.get(noteId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      const p = pending.get(noteId);
      if (p) {
        p.persist(p.note, { fields: fieldList(p) });
        pending.delete(noteId);
      }
      timers.delete(noteId);
    }, delay);
    timers.set(noteId, timer);
  }

  function schedule(
    noteId: string,
    note: Note,
    persist: PersistFn,
    fields: readonly NoteMetadataField[] = [],
  ): void {
    const merged = new Set([...(pending.get(noteId)?.fields ?? []), ...fields]);
    pending.set(noteId, { note, persist, fields: merged });
    arm(noteId, delayMs);
  }

  function flushAll(persist: PersistFn): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const row of pending.values()) {
      persist(row.note, { fields: fieldList(row) });
    }
    timers.clear();
    pending.clear();
  }

  /** Move a pending save onto the remapped server id so title/metadata PATCH hits the UID. */
  function remapId(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const row = pending.get(fromId);
    const timer = timers.get(fromId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(fromId);
    }
    if (!row) return;
    pending.delete(fromId);
    pending.set(toId, { ...row, note: { ...row.note, id: toId } });
    arm(toId, delayMs);
  }

  return { schedule, flushAll, remapId };
}
