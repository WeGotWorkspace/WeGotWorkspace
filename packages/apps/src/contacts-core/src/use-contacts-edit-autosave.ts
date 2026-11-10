import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ContactCard } from "@/lib/models/contacts-types";
import type { ContactSending } from "@/contacts-core/src/contacts-draft-rows";
import {
  CONTACTS_AUTOSAVE_DEBOUNCE_MS,
  createContactSaveDebouncer,
} from "@/contacts-core/src/contacts-edit-autosave";
import {
  CONTACTS_CREATE_ID,
  contactEditDraftHasChanges,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";
import { useContactsAutosaveLifecycle } from "@/contacts-core/src/use-contacts-autosave-lifecycle";
import {
  cardDraftJson,
  useContactsRemoteMerge,
  type ContactSynced,
} from "@/contacts-core/src/use-contacts-remote-merge";

type Persist = (contactId: string, draft: ContactEditDraft) => Promise<void>;

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

type Latest = {
  activeId: string;
  createMode: boolean;
  editMode: boolean;
  editDraft: ContactEditDraft | null;
};

const matchesSynced = (
  synced: Map<string, ContactSynced>,
  contactId: string,
  draft: ContactEditDraft,
) => synced.get(contactId)?.json === JSON.stringify(draft);

/** A contact's newest draft: the open one, else its stash. */
function newestDraft(latest: Latest, drafts: Map<string, ContactEditDraft>, contactId: string) {
  const open = latest.activeId === contactId && latest.editMode && !latest.createMode;
  return (open ? latest.editDraft : null) ?? drafts.get(contactId) ?? null;
}

/**
 * The open contact saves itself: each change is saved after a typing pause, and on
 * unmount. Only a draft that differs from what its card is known to hold (see
 * `markSynced`, kept per contact) is written, so opening a contact never writes.
 * Every switch of the open contact goes through `switchEditDraftTo`, which stashes an
 * unsaved draft and brings back the next contact's. A card changed on another device
 * is merged into the open draft field by field. Saves of one contact run one after
 * another; when one lands and the draft has moved on (even back to what the card held
 * before), the newest draft is saved too. The caller sets `persistRef` to the function
 * that sends a draft.
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
  const syncedRef = useRef(new Map<string, ContactSynced>());
  const ownCardsRef = useRef(new WeakSet<ContactCard>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  // The draft each contact's save is sending now: what its card will hold.
  const sendingRef = useRef(new Map<string, ContactSending>());
  // Contacts still being created: their saves wait for the real id.
  const heldRef = useRef(new Set<string>());
  const latestRef = useRef<Latest>({ activeId, createMode, editMode, editDraft });
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
    function run(contactId: string, draft: ContactEditDraft) {
      if (heldRef.current.has(contactId)) {
        contactDraftsRef.current.set(contactId, draft);
        return;
      }
      // The save landed but the draft moved on meanwhile: save the newest one too,
      // unless a later save (waiting or queued behind this one) already carries it.
      const saveNewest = () => {
        if (inFlightRef.current.get(contactId) !== next) return;
        const latest = newestDraft(latestRef.current, contactDraftsRef.current, contactId);
        if (!latest || debouncerRef.current.has(contactId)) return;
        if (JSON.stringify(latest) === JSON.stringify(sent)) return;
        if (matchesSynced(syncedRef.current, contactId, latest)) {
          contactDraftsRef.current.delete(contactId);
          return;
        }
        const card = cardsRef.current.find((row) => row.id === contactId);
        if (!card || !contactEditDraftHasChanges(latest, card)) return;
        contactDraftsRef.current.set(contactId, latest);
        debouncerRef.current.schedule(contactId, latest, run);
      };
      // The draft this save sends: when it runs behind another save, the newest one,
      // since remote changes merged into the draft meanwhile.
      let sent = draft;
      const previous = inFlightRef.current.get(contactId) ?? Promise.resolve();
      const send = async () => {
        sent = newestDraft(latestRef.current, contactDraftsRef.current, contactId) ?? draft;
        const synced = syncedRef.current.get(contactId);
        const sending = {
          draft: sent,
          base: synced ? (JSON.parse(synced.json) as ContactEditDraft) : null,
        };
        sendingRef.current.set(contactId, sending);
        try {
          await persistRef.current(contactId, sent);
        } finally {
          if (sendingRef.current.get(contactId) === sending) sendingRef.current.delete(contactId);
        }
      };
      const next = previous
        .then(send)
        .then(saveNewest)
        .catch(() => {});
      inFlightRef.current.set(contactId, next);
      void next.then(() => {
        if (inFlightRef.current.get(contactId) === next) inFlightRef.current.delete(contactId);
      });
    },
    [cardsRef, contactDraftsRef],
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
        // A save on its way may still need the draft (see `saveNewest` in `run`).
        const unsaved =
          !matchesSynced(syncedRef.current, leaving, current.editDraft) ||
          inFlightRef.current.has(leaving);
        if (unsaved) contactDraftsRef.current.set(leaving, current.editDraft);
        else contactDraftsRef.current.delete(leaving);
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

  const lifecycle = useContactsAutosaveLifecycle({
    debouncerRef,
    syncedRef,
    seenRef,
    heldRef,
    inFlightRef,
    contactDraftsRef,
    run,
  });

  useContactsRemoteMerge({
    activeId,
    activeCard,
    createMode,
    editMode,
    editDraft,
    setEditDraft,
    syncedRef,
    sendingRef,
    ownCardsRef,
    seenRef,
    markSynced,
  });

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

    // A card not in `cardsRef` yet (just created) keeps its waiting save.
    const card = cardsRef.current.find((row) => row.id === activeId);
    if (!card) return;
    // Back to what the card holds, or only an empty row added: a waiting save is stale.
    if (!contactEditDraftHasChanges(editDraft, card)) {
      debouncerRef.current.cancel(activeId);
      return;
    }

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
    ...lifecycle,
  };
}
