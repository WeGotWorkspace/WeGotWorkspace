import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { rebaseContactDraft, withBlankRowsFrom } from "@/contacts-core/src/contacts-draft-rows";
import {
  CONTACTS_CREATE_ID,
  contactCardToEditDraft,
  contactEditDraftHasChanges,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";

type Persist = (contactId: string, draft: ContactEditDraft) => Promise<void>;

/** What a contact's card is known to hold: the draft it matches, and the card it came from. */
type Synced = { json: string; base: string };

type UseContactsEditAutosaveArgs = {
  activeId: string;
  /** The open contact's card, to notice changes made on another device. */
  activeCard: ContactCard | undefined;
  createMode: boolean;
  editMode: boolean;
  editDraft: ContactEditDraft | null;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>;
  cardsRef: MutableRefObject<ContactCard[]>;
  /** Unsaved drafts per contact, so switching contacts keeps what was typed. */
  contactDraftsRef: MutableRefObject<Map<string, ContactEditDraft>>;
};

const cardDraftJson = (card: ContactCard) => JSON.stringify(contactCardToEditDraft(card));

const matchesSynced = (synced: Map<string, Synced>, contactId: string, draft: ContactEditDraft) =>
  synced.get(contactId)?.json === JSON.stringify(draft);

/**
 * The open contact saves itself: each change is saved after a typing pause, and on
 * unmount. Only a draft that differs from what its card is known to hold (see
 * `markSynced`, kept per contact) is written, so opening a contact never writes.
 * Every switch of the open contact goes through `switchEditDraftTo`, which stashes an
 * unsaved draft and brings back the next contact's. A card changed on another device
 * is merged into the open draft field by field. Saves of one contact run one after
 * another. The caller sets `persistRef` to the function that sends a draft.
 */
export function useContactsEditAutosave({
  activeId,
  activeCard,
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
  const syncedRef = useRef(new Map<string, Synced>());
  // Cards this tab set itself (an optimistic save): not a change from elsewhere.
  const ownCardsRef = useRef(new WeakSet<ContactCard>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  // Contacts still being created: their saves wait for the real id.
  const heldRef = useRef(new Set<string>());
  const latestRef = useRef({ activeId, createMode, editMode, editDraft });
  // The draft autosave last saw, with the contact it was open on.
  const seenRef = useRef<{ contactId: string; draft: ContactEditDraft | null }>({
    contactId: "",
    draft: null,
  });

  useLayoutEffect(() => {
    latestRef.current = { activeId, createMode, editMode, editDraft };
  });

  const markSynced = useCallback(
    (contactId: string, draft: ContactEditDraft, card: ContactCard) => {
      syncedRef.current.set(contactId, { json: JSON.stringify(draft), base: cardDraftJson(card) });
    },
    [],
  );

  const markOwnCard = useCallback((card: ContactCard) => {
    ownCardsRef.current.add(card);
  }, []);

  const run = useCallback(
    (contactId: string, draft: ContactEditDraft) => {
      if (heldRef.current.has(contactId)) {
        contactDraftsRef.current.set(contactId, draft);
        return;
      }
      const previous = inFlightRef.current.get(contactId) ?? Promise.resolve();
      const next = previous.then(() => persistRef.current(contactId, draft)).catch(() => {});
      inFlightRef.current.set(contactId, next);
      void next.then(() => {
        if (inFlightRef.current.get(contactId) === next) inFlightRef.current.delete(contactId);
      });
    },
    [contactDraftsRef],
  );

  const flushAll = useCallback(() => debouncerRef.current.flushAll(run), [run]);

  /** Sends the contact's pending edit now; resolves once its saves have finished. */
  const flushContact = useCallback(
    (contactId: string) => {
      debouncerRef.current.flush(contactId, run);
      return inFlightRef.current.get(contactId) ?? Promise.resolve();
    },
    [run],
  );

  /** Opening another contact: keep an unsaved draft, bring back the next one's. */
  const switchEditDraftTo = useCallback(
    (contactId: string) => {
      const current = latestRef.current;
      if (current.createMode || contactId === current.activeId) return;
      const leaving = current.activeId;
      if (current.editMode && current.editDraft && leaving && leaving !== CONTACTS_CREATE_ID) {
        if (matchesSynced(syncedRef.current, leaving, current.editDraft))
          contactDraftsRef.current.delete(leaving);
        else contactDraftsRef.current.set(leaving, current.editDraft);
      }
      const stashed = contactDraftsRef.current.get(contactId);
      // Drop the previous contact's draft now: the next one lands in a transition, and
      // until then autosave must not see the old draft beside the new contact.
      setEditDraft(null);
      setEditMode(Boolean(stashed));
      if (stashed) startTransition(() => setEditDraft(stashed));
    },
    [contactDraftsRef, setEditDraft, setEditMode],
  );

  /** Saves of a contact still being created wait until it has its real id. */
  const holdUntilCreated = useCallback((contactId: string) => {
    heldRef.current.add(contactId);
  }, []);

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
    [contactDraftsRef, run],
  );

  /** A contact that is gone (a create undone): forget its draft and pending edit. */
  const forgetContact = useCallback(
    (contactId: string) => {
      heldRef.current.delete(contactId);
      debouncerRef.current.cancel(contactId);
      syncedRef.current.delete(contactId);
      contactDraftsRef.current.delete(contactId);
    },
    [contactDraftsRef],
  );

  const activeCardJson = useMemo(() => (activeCard ? cardDraftJson(activeCard) : ""), [activeCard]);

  // Another device changed the open card: merge it into the draft, field by field.
  useEffect(() => {
    if (!activeCard || activeCard.id !== activeId || createMode || !editMode || !editDraft) return;
    const seen = seenRef.current;
    if (seen.draft === editDraft && seen.contactId !== activeId) return;
    if (ownCardsRef.current.has(activeCard)) return;
    const synced = syncedRef.current.get(activeId);
    if (!synced || synced.base === activeCardJson) return;
    const fresh = contactCardToEditDraft(activeCard);
    markSynced(activeId, withBlankRowsFrom(fresh, editDraft), activeCard);
    setEditDraft(rebaseContactDraft(editDraft, JSON.parse(synced.json), fresh));
  }, [
    activeCard,
    activeCardJson,
    activeId,
    createMode,
    editDraft,
    editMode,
    markSynced,
    setEditDraft,
  ]);

  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { contactId: activeId, draft: editDraft };
    if (!editMode || createMode || !editDraft || !activeId || activeId === CONTACTS_CREATE_ID)
      return;
    // Another contact opened but the draft is still the previous one's: never save
    // (or stash) it under the new contact. Its own draft follows.
    if (seen.draft === editDraft && seen.contactId !== activeId) return;

    if (matchesSynced(syncedRef.current, activeId, editDraft)) {
      debouncerRef.current.cancel(activeId);
      contactDraftsRef.current.delete(activeId);
      return;
    }

    contactDraftsRef.current.set(activeId, editDraft);

    const card = cardsRef.current.find((row) => row.id === activeId);
    if (!card || !contactEditDraftHasChanges(editDraft, card)) return;

    debouncerRef.current.schedule(activeId, editDraft, run);
  }, [activeId, cardsRef, contactDraftsRef, createMode, editDraft, editMode, run]);

  // Leaving the app saves what is still waiting for its pause.
  useEffect(() => flushAll, [flushAll]);

  return {
    persistRef,
    markSynced,
    markOwnCard,
    flushAll,
    flushContact,
    switchEditDraftTo,
    holdUntilCreated,
    rekeyContact,
    forgetContact,
  };
}
