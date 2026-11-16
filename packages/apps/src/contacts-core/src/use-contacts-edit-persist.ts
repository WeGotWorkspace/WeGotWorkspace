import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { withBlankRowsFrom } from "@/contacts-core/src/contacts-draft-rows";
import { contactEditDraftHasChanges } from "@/contacts-core/src/contacts-edit-utils";
import {
  contactCardToEditDraft,
  editDraftToPatch,
  type ContactEditDraft,
} from "@/lib/models/contacts-edit-draft";
import { mergeContactFromPatch } from "@/lib/models/contacts-patch-merge";
import type { ContactCard, ContactsAPIOperations } from "@/lib/models/contacts-types";
import { contactMutationOpts } from "@/contacts-core/src/contacts-undo-writes";

type UseContactsEditPersistArgs = {
  operations: ContactsAPIOperations | undefined;
  mutationsLocked: boolean;
  cardsRef: MutableRefObject<ContactCard[]>;
  activeIdRef: MutableRefObject<string>;
  contactDraftsRef: MutableRefObject<Map<string, ContactEditDraft>>;
  setCards: Dispatch<SetStateAction<ContactCard[]>>;
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>;
  markSynced: (contactId: string, draft: ContactEditDraft, card: ContactCard) => void;
  markOwnCard: (card: ContactCard) => void;
  showMutationError: () => void;
  /** Saved cards of contacts that left the list meanwhile (a delete that can be undone). */
  offListCardsRef: MutableRefObject<Map<string, ContactCard>>;
};

/** Drop a stashed draft only when it is the one just saved, never newer typing. */
function dropStashIfSaved(
  drafts: Map<string, ContactEditDraft>,
  contactId: string,
  draft: ContactEditDraft,
) {
  const stashed = drafts.get(contactId);
  if (stashed && (stashed === draft || JSON.stringify(stashed) === JSON.stringify(draft))) {
    drafts.delete(contactId);
  }
}

/**
 * Sends one contact's draft: an optimistic card at once, then the saved card. The
 * card is also written to `cardsRef` straight away, so a save that follows this one
 * builds its patch (and its precondition) on the saved card.
 */
export function useContactsEditPersist({
  operations,
  mutationsLocked,
  cardsRef,
  activeIdRef,
  contactDraftsRef,
  setCards,
  setEditDraft,
  markSynced,
  markOwnCard,
  showMutationError,
  offListCardsRef,
}: UseContactsEditPersistArgs) {
  const abortControllersRef = useRef(new Map<string, AbortController>());

  return useCallback(
    async (contactId: string, draft: ContactEditDraft) => {
      if (mutationsLocked) return;
      const card = cardsRef.current.find((row) => row.id === contactId);
      // A contact deleted (undo still possible) keeps its draft for the undo.
      if (!card) return;
      if (!contactEditDraftHasChanges(draft, card)) {
        dropStashIfSaved(contactDraftsRef.current, contactId, draft);
        return;
      }

      const patch = editDraftToPatch(draft, card);
      const merged = mergeContactFromPatch(card, patch);
      abortControllersRef.current.get(contactId)?.abort();
      const controller = new AbortController();
      abortControllersRef.current.set(contactId, controller);

      const putCard = (next: ContactCard) => {
        if (!cardsRef.current.some((row) => row.id === contactId)) {
          offListCardsRef.current.set(contactId, next);
          return;
        }
        cardsRef.current = cardsRef.current.map((row) => (row.id === contactId ? next : row));
        setCards((prev) => prev.map((row) => (row.id === contactId ? next : row)));
      };
      // The card now holds `draft`: its values, plus rows just added and not filled in.
      const settle = (saved: ContactCard) => {
        dropStashIfSaved(contactDraftsRef.current, contactId, draft);
        const next = withBlankRowsFrom(contactCardToEditDraft(saved), draft);
        markSynced(contactId, next, saved);
        // Typing that went on during the save stays: the next save sends it.
        if (activeIdRef.current === contactId) {
          setEditDraft((prev) => (prev === draft ? next : prev));
        }
      };

      markOwnCard(merged);
      putCard(merged);
      try {
        if (!operations) {
          settle(merged);
          return;
        }
        const saved = await operations.patchCard(
          contactId,
          patch,
          contactMutationOpts(card, controller.signal),
        );
        putCard(saved);
        settle(saved);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Put the card back, unless a newer one (another device's change) replaced ours.
        const current = cardsRef.current.find((row) => row.id === contactId);
        if (!current || current === merged) putCard(card);
        showMutationError();
      } finally {
        if (abortControllersRef.current.get(contactId) === controller) {
          abortControllersRef.current.delete(contactId);
        }
      }
    },
    [
      activeIdRef,
      cardsRef,
      contactDraftsRef,
      markOwnCard,
      markSynced,
      mutationsLocked,
      offListCardsRef,
      operations,
      setCards,
      setEditDraft,
      showMutationError,
    ],
  );
}
