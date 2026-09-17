import type { AddressBook, ContactCard } from "@wgw-api-generated/contacts-types";
import type { ContactsUIData } from "@/contacts-core/src/contacts-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

import { mockWorkspaceSession } from "./workspace-session-mock";

export type ContactsAppBootstrap = {
  data: ContactsUIData;
  session: WorkspaceSession;
};

const fullRights: AddressBook["myRights"] = {
  mayRead: true,
  mayWrite: true,
  mayShare: true,
  mayDelete: false,
};

const mockAddressBooks: AddressBook[] = [
  {
    id: "default",
    name: "Default Address Book",
    description: null,
    sortOrder: 0,
    isDefault: true,
    isSubscribed: true,
    isSharee: false,
    shareWith: null,
    myRights: fullRights,
  },
  {
    id: "work",
    name: "Work",
    description: null,
    sortOrder: 1,
    isDefault: false,
    isSubscribed: true,
    isSharee: false,
    shareWith: null,
    myRights: {
      mayRead: true,
      mayWrite: true,
      mayShare: false,
      mayDelete: true,
    },
  },
];

const mockCards = [
  {
    "@type": "Card",
    version: "1.0",
    id: "card-jane",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440010",
    addressBookIds: { default: true as const },
    name: { "@type": "Name" as const, isOrdered: false, full: "Jane Doe" },
    organizations: {
      "550e8400-e29b-41d4-a716-446655440011": {
        "@type": "Organization" as const,
        name: "Acme Corp",
      },
    },
    emails: {
      "550e8400-e29b-41d4-a716-446655440012": {
        "@type": "EmailAddress" as const,
        address: "jane@example.com",
        contexts: { work: true },
      },
    },
    phones: {
      "550e8400-e29b-41d4-a716-446655440013": {
        "@type": "Phone" as const,
        number: "+1-555-0101",
        contexts: { private: true },
      },
    },
    links: {
      "550e8400-e29b-41d4-a716-446655440015": {
        "@type": "Link" as const,
        uri: "https://example.com/jane",
        contexts: { work: true },
      },
    },
    addresses: {
      "550e8400-e29b-41d4-a716-446655440014": {
        "@type": "Address" as const,
        street: "123 Main St",
        locality: "Springfield",
        region: "IL",
        postcode: "62701",
        country: "US",
      },
    },
    anniversaries: {
      "550e8400-e29b-41d4-a716-446655440017": {
        "@type": "Anniversary" as const,
        kind: "birth" as const,
        date: { "@type": "PartialDate" as const, year: 1985, month: 4, day: 23 },
      },
    },
    media: {
      "550e8400-e29b-41d4-a716-446655440016": {
        "@type": "Media" as const,
        kind: "photo" as const,
        uri: "https://www.example.com/pub/photos/jqpublic.gif",
        mediaType: "image/gif",
      },
    },
  },
  {
    "@type": "Card",
    version: "1.0",
    id: "card-joe",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440020",
    addressBookIds: { work: true as const },
    name: { "@type": "Name" as const, isOrdered: false, full: "Joe Example" },
    emails: {
      "550e8400-e29b-41d4-a716-446655440021": {
        "@type": "EmailAddress" as const,
        address: "joe@example.com",
      },
    },
    phones: {
      "550e8400-e29b-41d4-a716-446655440022": {
        "@type": "Phone" as const,
        number: "+1-555-0100",
      },
    },
  },
  {
    "@type": "Card",
    version: "1.0",
    id: "card-acme",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440030",
    kind: "org" as const,
    addressBookIds: { default: true as const },
    name: { "@type": "Name" as const, isOrdered: false, full: "Jane Doe" },
    organizations: {
      "550e8400-e29b-41d4-a716-446655440031": {
        "@type": "Organization" as const,
        name: "Acme Corp",
      },
    },
    emails: {
      "550e8400-e29b-41d4-a716-446655440032": {
        "@type": "EmailAddress" as const,
        address: "info@acme.com",
      },
    },
  },
  {
    "@type": "Card",
    version: "1.0",
    id: "card-group-friends",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440100",
    kind: "group" as const,
    addressBookIds: { default: true as const },
    name: { "@type": "Name" as const, isOrdered: false, full: "Friends" },
    members: {
      "urn:uuid:550e8400-e29b-41d4-a716-446655440010": true,
      "urn:uuid:550e8400-e29b-41d4-a716-446655440020": true,
    },
  },
  {
    "@type": "Card",
    version: "1.0",
    id: "card-group-family",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440101",
    kind: "group" as const,
    addressBookIds: { default: true as const },
    name: { "@type": "Name" as const, isOrdered: false, full: "Family" },
    members: {
      "urn:uuid:550e8400-e29b-41d4-a716-446655440010": true,
    },
  },
] as unknown as ContactCard[];

export function createContactsAppBootstrap(overrides?: {
  data?: ContactsUIData;
  session?: WorkspaceSession;
}): ContactsAppBootstrap {
  return {
    data: overrides?.data ?? { addressBooks: mockAddressBooks, cards: mockCards },
    session: overrides?.session ?? mockWorkspaceSession,
  };
}
