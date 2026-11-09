import {
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { rebaseContactDraft, withBlankRowsFrom } from "@/contacts-core/src/contacts-draft-rows";
import {
  contactCardToEditDraft,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

/** What a contact's card is known to hold: the draft it matches, and the card it came from. */
export type ContactSynced = { json: string; base: string };

export const cardDraftJson = (card: ContactCard) => JSON.stringify(contactCardToEditDraft(card));

type UseContactsRemoteMergeArgs = {
  activeId: string;
  activeCard: ContactCard | undefined;
  createMode: boolean;
  editMode: boolean;
  editDraft: ContactEditDraft | null;
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>;
  syncedRef: MutableRefObject<Map<string, ContactSynced>>;
  /** The draft a contact's save is sending now. */
  sendingRef: MutableRefObject<Map<string, ContactEditDraft>>;
  /** Cards this tab set itself (an optimistic save): not a change from elsewhere. */
  ownCardsRef: MutableRefObject<WeakSet<ContactCard>>;
  /** The draft autosave last saw, with the contact it was open on. */
  seenRef: MutableRefObject<{ contactId: string; draft: ContactEditDraft | null }>;
  markSynced: (contactId: string, draft: ContactEditDraft, card: ContactCard) => void;
};

/**
 * Another device changed the open card (or this tab's own save came back through a
 * sync): merge it into the draft, field by field (see `rebaseContactDraft`). The fresh card, with the empty rows and revealed fields the
 * draft shows, becomes what the contact is known to hold, so a merge without local
 * edits schedules no save.
 */
export function useContactsRemoteMerge({
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
}: UseContactsRemoteMergeArgs) {
  const activeCardJson = useMemo(() => (activeCard ? cardDraftJson(activeCard) : ""), [activeCard]);

  useEffect(() => {
    if (!activeCard || activeCard.id !== activeId || createMode || !editMode || !editDraft) return;
    const seen = seenRef.current;
    if (seen.draft === editDraft && seen.contactId !== activeId) return;
    if (ownCardsRef.current.has(activeCard)) return;
    const synced = syncedRef.current.get(activeId);
    if (!synced || synced.base === activeCardJson) return;
    const fresh = contactCardToEditDraft(activeCard);
    // While a save is on its way, the card it brings back may arrive first (a sync): a
    // field is touched when it differs from what that save sends, so an edit undone
    // meanwhile is not taken for "untouched" and overwritten.
    const base = sendingRef.current.get(activeId) ?? (JSON.parse(synced.json) as ContactEditDraft);
    markSynced(activeId, withBlankRowsFrom(fresh, editDraft), activeCard);
    setEditDraft(rebaseContactDraft(editDraft, base, fresh));
  }, [
    activeCard,
    activeCardJson,
    activeId,
    createMode,
    editDraft,
    editMode,
    markSynced,
    ownCardsRef,
    seenRef,
    sendingRef,
    setEditDraft,
    syncedRef,
  ]);
}
