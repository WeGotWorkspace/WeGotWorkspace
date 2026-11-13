import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { contactCardToEditDraft } from "@/lib/models/contacts-edit-draft";

export function getContactsDetailStoryCard() {
  return createContactsAppBootstrap().data.cards[0];
}

export function getContactsDetailStoryDraft() {
  const card = getContactsDetailStoryCard();
  if (!card) throw new Error("Contacts bootstrap seed is missing cards.");
  return contactCardToEditDraft(card);
}
