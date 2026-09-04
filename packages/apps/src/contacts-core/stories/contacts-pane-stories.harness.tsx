import { useEffect, useMemo } from "react";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsUIData,
} from "@/contacts-core/src/contacts-types";
import { useContactsController } from "@/contacts-core/src/use-contacts-controller";
import { splitVcardBlocks } from "@/contacts-core/src/contacts-vcard-import";

export type ContactsStorySpies = {
  patchCalls: Array<{ cardId: string; patch: ContactCardPatch }>;
  createCalls: ContactCardCreate[];
};

export const contactsStorySpies: ContactsStorySpies = {
  patchCalls: [],
  createCalls: [],
};

export function resetContactsStorySpies() {
  contactsStorySpies.patchCalls = [];
  contactsStorySpies.createCalls = [];
}

export type ContactsPaneStoryHarnessOptions = {
  listLoading?: boolean;
  listRefreshing?: boolean;
  cardsOverride?: ContactCard[];
  data?: ContactsUIData;
  operations?: ContactsAPIOperations;
};

export function createContactsStoryOperations(cards: ContactCard[]): ContactsAPIOperations {
  return {
    listAddressBooks: async () => createContactsAppBootstrap().data.addressBooks,
    listCards: async () => cards,
    getCard: async (cardId) => {
      const card = cards.find((row) => row.id === cardId);
      if (!card) throw new Error(`Missing card ${cardId}`);
      return card;
    },
    createCard: async (body) => {
      contactsStorySpies.createCalls.push(body);
      return {
        "@type": "Card",
        version: "1.0",
        id: "card-created",
        uid: "urn:uuid:created",
        ...body,
      } as ContactCard;
    },
    patchCard: async (cardId, patch) => {
      contactsStorySpies.patchCalls.push({ cardId, patch });
      const card = cards.find((row) => row.id === cardId);
      if (!card) throw new Error(`Missing card ${cardId}`);
      return {
        ...card,
        phones: { ...card.phones, ...patch.phones },
        emails: { ...card.emails, ...patch.emails },
        name: patch.name ? { ...card.name, ...patch.name } : card.name,
      } as ContactCard;
    },
    deleteCard: async () => {},
    importVcards: async (vcardText) => {
      const blocks = splitVcardBlocks(vcardText);
      const list = blocks.map((block, index) => {
        const fnMatch = /(?:^|\n)FN[^:]*:(.+)/i.exec(block);
        const name = fnMatch?.[1]?.trim() || `Imported ${index + 1}`;
        return {
          "@type": "Card",
          version: "1.0",
          id: `card-imported-${index}`,
          uid: `urn:uuid:imported-${index}`,
          addressBookIds: { default: true },
          name: { full: name },
        } as ContactCard;
      });
      return { list, errors: [] };
    },
  };
}

export function useContactsPaneStoryController(options?: ContactsPaneStoryHarnessOptions) {
  const bootstrap = useMemo(() => {
    if (options?.data) {
      return createContactsAppBootstrap({ data: options.data });
    }
    const base = createContactsAppBootstrap();
    if (options?.cardsOverride !== undefined) {
      return createContactsAppBootstrap({
        data: { ...base.data, cards: options.cardsOverride },
      });
    }
    return base;
  }, [options?.cardsOverride, options?.data]);

  const operations = useMemo(
    () => options?.operations ?? createContactsStoryOperations(bootstrap.data.cards),
    [bootstrap.data.cards, options?.operations],
  );

  useEffect(() => {
    resetContactsStorySpies();
  }, []);

  return useContactsController({
    data: bootstrap.data,
    listLoading: options?.listLoading ?? false,
    listRefreshing: options?.listRefreshing ?? false,
    operations,
  });
}
