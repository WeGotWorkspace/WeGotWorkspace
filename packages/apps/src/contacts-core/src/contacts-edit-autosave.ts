import type { ContactEditDraft } from "@/contacts-core/src/contacts-edit-utils";

/** Delay after the last edit before flushing a debounced contact save (ms). */
export const CONTACTS_AUTOSAVE_DEBOUNCE_MS = 600;

type PersistFn = (contactId: string, draft: ContactEditDraft) => void;

/**
 * Per-contact debounced save scheduler.
 *
 * Call `schedule(contactId, draft, persist)` on each edit; the actual persist call
 * fires only after `delayMs` of inactivity for that contact.
 * Call `flushAll(persist)` to immediately fire any pending saves (e.g. on unmount).
 */
export function createContactSaveDebouncer(delayMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, ContactEditDraft>();

  function schedule(contactId: string, draft: ContactEditDraft, persist: PersistFn): void {
    const existing = timers.get(contactId);
    if (existing) clearTimeout(existing);
    pending.set(contactId, draft);
    const timer = setTimeout(() => {
      const d = pending.get(contactId);
      if (d) {
        persist(contactId, d);
        pending.delete(contactId);
      }
      timers.delete(contactId);
    }, delayMs);
    timers.set(contactId, timer);
  }

  /** Drop a pending save (the draft is back to what the card already holds). */
  function cancel(contactId: string): void {
    const timer = timers.get(contactId);
    if (timer) clearTimeout(timer);
    timers.delete(contactId);
    pending.delete(contactId);
  }

  /** Save one contact's pending draft now, if it has one. */
  function flush(contactId: string, persist: PersistFn): void {
    const draft = pending.get(contactId);
    cancel(contactId);
    if (draft) persist(contactId, draft);
  }

  function flushAll(persist: PersistFn): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const [contactId, draft] of pending.entries()) {
      persist(contactId, draft);
    }
    timers.clear();
    pending.clear();
  }

  /** Whether a save of this contact is waiting for its pause. */
  function has(contactId: string): boolean {
    return pending.has(contactId);
  }

  return { schedule, cancel, flush, flushAll, has };
}
