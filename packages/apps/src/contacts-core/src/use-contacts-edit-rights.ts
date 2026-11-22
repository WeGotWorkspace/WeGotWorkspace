import { useEffect, useMemo } from "react";
import { canShowContactAddressBookMove } from "@/contacts-core/src/contacts-address-book-move";
import { writableMoveAddressBooks } from "@/contacts-core/src/contacts-addressbook-write";
import type { AddressBook, ContactCard, ContactsAPIOperations } from "@/lib/models/contacts-types";

type Params = {
  active: ContactCard | undefined;
  createMode: boolean;
  mutationsLocked: boolean;
  operations?: ContactsAPIOperations;
  addressBooks: readonly AddressBook[];
  /** Cards still partial (lean first download), by id. */
  partialCardIds?: readonly string[];
};

/**
 * Whether the open contact may be edited.
 *
 * The hard rule: a partial card (stored from a lean first download: name,
 * emails and what the list needs) is never edited from its partial copy, since
 * saving it would drop every field it lacks. Opening one fetches the whole card
 * at once (online); until it is in, or offline, it stays read-only. The
 * operations layer refuses a write on a partial card as well.
 */
export function useContactsEditRights({
  active,
  createMode,
  mutationsLocked,
  operations,
  addressBooks,
  partialCardIds,
}: Params) {
  const activeIsPartial = Boolean(active && partialCardIds?.includes(active.id));
  const activePartialId = activeIsPartial ? active?.id : undefined;
  const getCardOperation = operations?.getCard;
  useEffect(() => {
    if (!activePartialId || !getCardOperation) return;
    void getCardOperation(activePartialId).catch(() => undefined);
  }, [activePartialId, getCardOperation]);

  const canEdit = useMemo(() => {
    if (mutationsLocked) return false;
    if (createMode) return true;
    if (!active) return false;
    if (activeIsPartial) return false;
    const bookIds = Object.keys(active.addressBookIds ?? {});
    if (bookIds.length === 0) return Boolean(operations);
    return bookIds.some((bookId) => {
      const book = addressBooks.find((row) => row.id === bookId);
      return book?.myRights?.mayWrite !== false;
    });
  }, [active, activeIsPartial, addressBooks, createMode, mutationsLocked, operations]);

  const writableMoveBooks = useMemo(() => writableMoveAddressBooks(addressBooks), [addressBooks]);

  const canMoveActiveContact = useMemo(
    () =>
      canShowContactAddressBookMove({
        createMode,
        canEdit,
        card: active,
        writableBookCount: writableMoveBooks.length,
      }),
    [active, canEdit, createMode, writableMoveBooks.length],
  );

  return { canEdit, activeIsPartial, writableMoveBooks, canMoveActiveContact };
}
