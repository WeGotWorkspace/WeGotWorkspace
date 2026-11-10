import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { QueueMutation } from "@/hooks/use-queued-mutation";
import type { ContactEditDraft } from "@/contacts-core/src/contacts-edit-utils";
import type { ContactCard, ContactsAPIOperations } from "@/contacts-core/src/contacts-types";
import { contactMutationOpts } from "@/contacts-core/src/contacts-undo-writes";

type UseContactsDeleteCardsArgs = {
  operations: ContactsAPIOperations | undefined;
  mutationsLocked: boolean;
  toastMessage: string;
  cardsRef: MutableRefObject<ContactCard[]>;
  setCards: Dispatch<SetStateAction<ContactCard[]>>;
  activeId: string;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSelectionMode: (on: boolean) => void;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  setEditDraft: Dispatch<SetStateAction<ContactEditDraft | null>>;
  setCreateMode: Dispatch<SetStateAction<boolean>>;
  /** Switches the open contact, carrying drafts over (see `switchEditDraftTo`). */
  openContact: (id: string) => void;
  queueMutation: QueueMutation;
  /** Stops a contact's pending edit; the returned function awaits its saves on their way. */
  pauseContact: (contactId: string) => () => Promise<void>;
  forgetContact: (contactId: string) => void;
};

/**
 * Deleting contacts, with undo. An edit of a deleted contact is not lost: its pending
 * save stops and its draft stays stashed, so undo brings it back and saves it. A save
 * already on its way may land after the delete: undo then puts back the saved card (see
 * `offListCardsRef`, filled by the persist hook), and the delete waits for that save
 * and sends the saved card's etag.
 */
export function useContactsDeleteCards({
  operations,
  mutationsLocked,
  toastMessage,
  cardsRef,
  setCards,
  activeId,
  selectedIds,
  setSelectedIds,
  setSelectionMode,
  setEditMode,
  setEditDraft,
  setCreateMode,
  openContact,
  queueMutation,
  pauseContact,
  forgetContact,
}: UseContactsDeleteCardsArgs) {
  const offListCardsRef = useRef(new Map<string, ContactCard>());

  const deleteCards = useCallback(
    (ids: string[]) => {
      if (mutationsLocked || ids.length === 0) return;
      const previousCards = cardsRef.current;
      const previousActiveId = activeId;
      const previousSelectedIds = selectedIds;
      const shouldExitSelection =
        ids.length === selectedIds.length &&
        selectedIds.length > 0 &&
        ids.every((id) => selectedIds.includes(id));

      if (ids.includes(activeId)) {
        openContact("");
        setEditMode(false);
        setEditDraft(null);
        setCreateMode(false);
      }
      const savesOf = new Map(ids.map((id) => [id, pauseContact(id)]));
      for (const id of ids) offListCardsRef.current.delete(id);
      cardsRef.current = cardsRef.current.filter((card) => !ids.includes(card.id));
      setCards((prev) => prev.filter((card) => !ids.includes(card.id)));
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      if (shouldExitSelection) setSelectionMode(false);

      const latestCard = (card: ContactCard | undefined) =>
        (card && offListCardsRef.current.get(card.id)) ?? card;
      const rollback = () => {
        const restored = previousCards.map((card) =>
          ids.includes(card.id) ? latestCard(card)! : card,
        );
        for (const id of ids) offListCardsRef.current.delete(id);
        cardsRef.current = restored;
        setCards(restored);
        setSelectedIds(previousSelectedIds);
        openContact(previousActiveId);
        if (previousSelectedIds.length > 0) setSelectionMode(true);
      };

      queueMutation({
        key: `contacts:delete:${ids.slice().sort().join(",")}`,
        toastMessage,
        irreversible: true,
        execute: async (signal) => {
          if (!operations) return;
          await Promise.all(
            ids.map(async (id) => {
              await savesOf.get(id)!();
              const card = latestCard(previousCards.find((row) => row.id === id));
              await operations.deleteCard(id, contactMutationOpts(card, signal));
            }),
          );
          for (const id of ids) {
            forgetContact(id);
            offListCardsRef.current.delete(id);
          }
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Deletion undone.",
      });
    },
    [
      activeId,
      cardsRef,
      forgetContact,
      mutationsLocked,
      openContact,
      operations,
      pauseContact,
      queueMutation,
      selectedIds,
      setCards,
      setCreateMode,
      setEditDraft,
      setEditMode,
      setSelectedIds,
      setSelectionMode,
      toastMessage,
    ],
  );

  return { deleteCards, offListCardsRef };
}
