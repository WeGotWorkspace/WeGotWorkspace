import { useCallback, type MutableRefObject } from "react";
import type { createContactSaveDebouncer } from "@/contacts-core/src/contacts-edit-autosave";
import type { ContactEditDraft } from "@/lib/models/contacts-edit-draft";
import type { ContactSynced } from "@/contacts-core/src/use-contacts-remote-merge";

type UseContactsAutosaveLifecycleArgs = {
  debouncerRef: MutableRefObject<ReturnType<typeof createContactSaveDebouncer>>;
  syncedRef: MutableRefObject<Map<string, ContactSynced>>;
  seenRef: MutableRefObject<{ contactId: string }>;
  /** Contacts still being created: their saves wait for the real id. */
  heldRef: MutableRefObject<Set<string>>;
  inFlightRef: MutableRefObject<Map<string, Promise<void>>>;
  contactDraftsRef: MutableRefObject<Map<string, ContactEditDraft>>;
  run: (contactId: string, draft: ContactEditDraft) => void;
};

/**
 * Autosave for contacts that are created, deleted or left behind by a view change:
 * their drafts and pending edits move with them, wait, or are forgotten.
 */
export function useContactsAutosaveLifecycle({
  debouncerRef,
  syncedRef,
  seenRef,
  heldRef,
  inFlightRef,
  contactDraftsRef,
  run,
}: UseContactsAutosaveLifecycleArgs) {
  /** Saves of a contact still being created wait until it has its real id. */
  const holdUntilCreated = useCallback(
    (contactId: string) => {
      heldRef.current.add(contactId);
    },
    [heldRef],
  );

  /** The created contact got its real id: carry its draft, state and pending edit over. */
  const rekeyContact = useCallback(
    (fromId: string, toId: string) => {
      heldRef.current.delete(fromId);
      debouncerRef.current.cancel(fromId);
      const synced = syncedRef.current.get(fromId);
      syncedRef.current.delete(fromId);
      if (synced) syncedRef.current.set(toId, synced);
      if (seenRef.current.contactId === fromId) seenRef.current.contactId = toId;
      const stashed = contactDraftsRef.current.get(fromId);
      contactDraftsRef.current.delete(fromId);
      if (!stashed) return;
      contactDraftsRef.current.set(toId, stashed);
      debouncerRef.current.schedule(toId, stashed, run);
    },
    [contactDraftsRef, debouncerRef, heldRef, run, seenRef, syncedRef],
  );

  /** A contact that is gone (a create undone, a delete done): forget its draft and pending edit. */
  const forgetContact = useCallback(
    (contactId: string) => {
      heldRef.current.delete(contactId);
      debouncerRef.current.cancel(contactId);
      syncedRef.current.delete(contactId);
      contactDraftsRef.current.delete(contactId);
    },
    [contactDraftsRef, debouncerRef, heldRef, syncedRef],
  );

  /**
   * A contact was deleted, with undo still possible: its pending edit stops and waits
   * in its stash (undo brings it back and saves it). Returns a function that resolves
   * once the contact's saves already on their way are done.
   */
  const pauseContact = useCallback(
    (contactId: string) => {
      debouncerRef.current.cancel(contactId);
      return () => inFlightRef.current.get(contactId) ?? Promise.resolve();
    },
    [debouncerRef, inFlightRef],
  );

  /** Another view opened: forget unsaved drafts, except of contacts still being created. */
  const dropDrafts = useCallback(() => {
    for (const contactId of [...contactDraftsRef.current.keys()]) {
      if (!heldRef.current.has(contactId)) contactDraftsRef.current.delete(contactId);
    }
  }, [contactDraftsRef, heldRef]);

  return { holdUntilCreated, rekeyContact, forgetContact, pauseContact, dropDrafts };
}
