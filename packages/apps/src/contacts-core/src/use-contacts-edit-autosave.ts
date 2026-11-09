import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  CONTACTS_AUTOSAVE_DEBOUNCE_MS,
  createContactSaveDebouncer,
} from "@/contacts-core/src/contacts-edit-autosave";
import {
  CONTACTS_CREATE_ID,
  contactEditDraftHasChanges,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";

type Persist = (contactId: string, draft: ContactEditDraft) => Promise<void>;

type UseContactsEditAutosaveArgs = {
  activeId: string;
  createMode: boolean;
  editMode: boolean;
  editDraft: ContactEditDraft | null;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>;
  cardsRef: MutableRefObject<ContactCard[]>;
  /** Unsaved drafts per contact, so switching contacts keeps what was typed. */
  contactDraftsRef: MutableRefObject<Map<string, ContactEditDraft>>;
};

/**
 * The open contact saves itself: each change is saved after a typing pause, and
 * on unmount. Only a draft that differs from what the card is known to hold is
 * written (see `markSynced`), so opening or switching contacts never writes.
 * Switching contacts stashes the open draft and restores the next one's.
 * The caller sets `persistRef` to the function that sends a draft.
 */
export function useContactsEditAutosave({
  activeId,
  createMode,
  editMode,
  editDraft,
  setEditMode,
  setEditDraft,
  cardsRef,
  contactDraftsRef,
}: UseContactsEditAutosaveArgs) {
  const debouncerRef = useRef(createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS));
  const persistRef = useRef<Persist>(async () => {});
  // The draft the open card is known to match (as loaded, or as last saved).
  const syncedDraftRef = useRef<{ contactId: string; json: string } | null>(null);
  // The draft autosave last saw, with the contact it was open on.
  const seenRef = useRef<{ contactId: string; draft: ContactEditDraft | null }>({
    contactId: "",
    draft: null,
  });

  const markSynced = useCallback((contactId: string, draft: ContactEditDraft) => {
    syncedDraftRef.current = { contactId, json: JSON.stringify(draft) };
  }, []);

  const flushAll = useCallback(() => {
    debouncerRef.current.flushAll((contactId, draft) => {
      void persistRef.current(contactId, draft);
    });
  }, []);

  const stashActiveEditDraft = useCallback(() => {
    if (!editMode || createMode || !editDraft || !activeId || activeId === CONTACTS_CREATE_ID)
      return;
    contactDraftsRef.current.set(activeId, editDraft);
  }, [activeId, contactDraftsRef, createMode, editDraft, editMode]);

  const restoreEditDraftForContact = useCallback(
    (contactId: string) => {
      const stashed = contactDraftsRef.current.get(contactId);
      if (stashed) {
        setEditMode(true);
        // Drop the previous contact's draft now: the next one lands in a transition, and
        // until then autosave must not see the old draft beside the new contact.
        setEditDraft(null);
        startTransition(() => {
          setEditDraft(stashed);
        });
        return;
      }
      setEditMode(false);
      setEditDraft(null);
    },
    [contactDraftsRef, setEditDraft, setEditMode],
  );

  /** Opening another contact: keep the open draft, bring back the next one's. */
  const switchEditDraftTo = useCallback(
    (contactId: string) => {
      stashActiveEditDraft();
      restoreEditDraftForContact(contactId);
    },
    [restoreEditDraftForContact, stashActiveEditDraft],
  );

  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { contactId: activeId, draft: editDraft };
    if (!editMode || createMode || !editDraft || !activeId || activeId === CONTACTS_CREATE_ID)
      return;
    // Another contact opened but the draft is still the previous one's: never save
    // (or stash) it under the new contact. Its own draft follows.
    if (seen.draft === editDraft && seen.contactId !== activeId) return;

    const synced = syncedDraftRef.current;
    if (synced?.contactId === activeId && synced.json === JSON.stringify(editDraft)) {
      debouncerRef.current.cancel(activeId);
      contactDraftsRef.current.delete(activeId);
      return;
    }

    contactDraftsRef.current.set(activeId, editDraft);

    const card = cardsRef.current.find((row) => row.id === activeId);
    if (!card || !contactEditDraftHasChanges(editDraft, card)) return;

    debouncerRef.current.schedule(activeId, editDraft, (contactId, draft) => {
      void persistRef.current(contactId, draft);
    });
  }, [activeId, cardsRef, contactDraftsRef, createMode, editDraft, editMode]);

  // Leaving the app saves what is still waiting for its pause.
  useEffect(() => flushAll, [flushAll]);

  return {
    persistRef,
    markSynced,
    flushAll,
    switchEditDraftTo,
  };
}
