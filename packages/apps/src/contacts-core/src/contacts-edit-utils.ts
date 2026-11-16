import {
  addressDraftToPatchValue,
  birthdayEntryFromIso,
  type ContactAddressDraft,
  type ContactChannelContext,
  contactContextToPatch,
  type ContactEditDraft,
  editDraftToPatch,
  newContactMapId,
  phoneTypeToPatch,
} from "@/lib/models/contacts-edit-draft";
import { enabledAddressBookIds } from "@/contacts-core/src/contacts-addressbook-color";
import { resolveDefaultCreateAddressBook } from "@/contacts-core/src/contacts-addressbook-write";
import { synthesizeNameFromComponents } from "@/lib/models/contacts-display";
import { canWriteContactGroup } from "@/contacts-core/src/contacts-group-utils";
import type { AddressBook, ContactCard, ContactCardCreate } from "@/lib/models/contacts-types";

export const CONTACTS_CREATE_ID = "__contacts_create__";

/** New empty channel row default: Home → JSContact `contexts.private` (vCard HOME). */
export const CONTACT_CHANNEL_DEFAULT_CONTEXT = "home" satisfies ContactChannelContext;

export function resolveDefaultContactsView(_addressBooks: AddressBook[]): string {
  return "all";
}

export function resolveCreateAddressBookIds(
  view: string,
  addressBooks: AddressBook[],
  cards: readonly Pick<ContactCard, "id" | "addressBookIds">[] = [],
): Record<string, true> {
  if (view.startsWith("book:")) {
    const bookId = view.slice(5);
    return { [bookId]: true };
  }
  if (view.startsWith("group:")) {
    const groupId = view.slice("group:".length);
    const group = cards.find((card) => card.id === groupId);
    const bookIds = enabledAddressBookIds(group?.addressBookIds);
    const preferred =
      bookIds.find((id) => {
        const book = addressBooks.find((row) => row.id === id);
        return book != null && book.myRights?.mayWrite !== false;
      }) ?? bookIds[0];
    if (preferred) return { [preferred]: true };
  }
  const defaultBook = resolveDefaultCreateAddressBook(addressBooks);
  if (!defaultBook) throw new Error("No address book available for create");
  return { [defaultBook.id]: true };
}

/** New contact is allowed on writable books and writable group views. */
export function canCreateContactInView(
  view: string,
  addressBooks: readonly { id: string; myRights?: { mayWrite?: boolean } | null }[],
  selectedGroup?: Pick<ContactCard, "addressBookIds"> | null,
  hasOperations = false,
): boolean {
  if (view.startsWith("group:"))
    return canWriteContactGroup(selectedGroup, addressBooks, hasOperations);
  if (view.startsWith("book:")) {
    const book = addressBooks.find((row) => row.id === view.slice("book:".length));
    return book != null && book.myRights?.mayWrite !== false;
  }
  return addressBooks.length > 0;
}

export function emptyContactEditDraft(): ContactEditDraft {
  return {
    nameGiven: "",
    nameGiven2: "",
    nameSurname: "",
    showGiven2: false,
    showAsCompany: false,
    phones: [],
    emails: [],
    addresses: [],
    urls: [],
    title: "",
    department: "",
    organization: "",
    notes: "",
    birthday: "",
  };
}

function addressDraftHasContent(row: ContactAddressDraft): boolean {
  return [row.street, row.locality, row.region, row.postalCode, row.country].some((part) =>
    part.trim(),
  );
}

/** True when the draft has at least one non-empty create field (any section). */
export function contactEditDraftHasContent(draft: ContactEditDraft): boolean {
  if (draft.nameGiven.trim() || draft.nameGiven2.trim() || draft.nameSurname.trim()) return true;
  if (draft.title.trim() || draft.department.trim() || draft.organization.trim()) return true;
  if (draft.notes.trim()) return true;
  if (draft.birthday.trim()) return true;
  if (draft.phones.some((row) => row.number.trim())) return true;
  if (draft.emails.some((row) => row.address.trim())) return true;
  if (draft.urls.some((row) => row.uri.trim())) return true;
  if (draft.addresses.some(addressDraftHasContent)) return true;
  return false;
}

function buildNameFromDraft(draft: ContactEditDraft): ContactCardCreate["name"] | undefined {
  const components = [];
  if (draft.nameGiven.trim()) {
    components.push({ kind: "given" as const, value: draft.nameGiven.trim() });
  }
  if (draft.nameGiven2.trim()) {
    components.push({ kind: "given2" as const, value: draft.nameGiven2.trim() });
  }
  if (draft.nameSurname.trim()) {
    components.push({ kind: "surname" as const, value: draft.nameSurname.trim() });
  }
  if (components.length === 0) return undefined;

  const full = synthesizeNameFromComponents(components);
  return {
    isOrdered: false,
    components,
    ...(full ? { full } : {}),
  } as ContactCardCreate["name"];
}

function buildPhonesFromDraft(
  rows: ContactEditDraft["phones"],
): NonNullable<ContactCardCreate["phones"]> {
  const phones: NonNullable<ContactCardCreate["phones"]> = {};
  for (const row of rows) {
    const number = row.number.trim();
    if (!number) continue;
    const entry: Record<string, unknown> = { number };
    const typed = phoneTypeToPatch(row.phoneType);
    if (typed.features) entry.features = typed.features;
    if (typed.contexts) entry.contexts = typed.contexts;
    phones[row.id] = entry as NonNullable<ContactCardCreate["phones"]>[string];
  }
  return phones;
}

function buildEmailsFromDraft(
  rows: ContactEditDraft["emails"],
): NonNullable<ContactCardCreate["emails"]> {
  const emails: NonNullable<ContactCardCreate["emails"]> = {};
  for (const row of rows) {
    const address = row.address.trim();
    if (!address) continue;
    const entry: Record<string, unknown> = { address };
    const contexts = contactContextToPatch(row.contextType);
    if (contexts) entry.contexts = contexts;
    emails[row.id] = entry as NonNullable<ContactCardCreate["emails"]>[string];
  }
  return emails;
}

function buildAddressesFromDraft(
  rows: ContactEditDraft["addresses"],
): NonNullable<ContactCardCreate["addresses"]> {
  const addresses: NonNullable<ContactCardCreate["addresses"]> = {};
  for (const row of rows) {
    if (!addressDraftHasContent(row)) continue;
    addresses[row.id] = addressDraftToPatchValue(row) as NonNullable<
      ContactCardCreate["addresses"]
    >[string];
  }
  return addresses;
}

function buildLinksFromDraft(
  rows: ContactEditDraft["urls"],
): NonNullable<ContactCardCreate["links"]> {
  const links: NonNullable<ContactCardCreate["links"]> = {};
  for (const row of rows) {
    const uri = row.uri.trim();
    if (!uri) continue;
    const entry: Record<string, unknown> = { uri };
    const contexts = contactContextToPatch(row.contextType);
    if (contexts) entry.contexts = contexts;
    links[row.id] = entry as NonNullable<ContactCardCreate["links"]>[string];
  }
  return links;
}

export function editDraftToCreateBody(
  draft: ContactEditDraft,
  addressBookIds: Record<string, true>,
): ContactCardCreate {
  const body: ContactCardCreate = {
    addressBookIds,
    kind: draft.showAsCompany ? "org" : "individual",
  };

  const name = buildNameFromDraft(draft);
  if (name) body.name = name;

  const phones = buildPhonesFromDraft(draft.phones);
  if (Object.keys(phones).length > 0) body.phones = phones;

  const emails = buildEmailsFromDraft(draft.emails);
  if (Object.keys(emails).length > 0) body.emails = emails;

  const addresses = buildAddressesFromDraft(draft.addresses);
  if (Object.keys(addresses).length > 0) body.addresses = addresses;

  const links = buildLinksFromDraft(draft.urls);
  if (Object.keys(links).length > 0) body.links = links;

  const orgName = draft.organization.trim();
  const department = draft.department.trim();
  if (orgName || department) {
    const orgEntry: Record<string, unknown> = {};
    if (orgName) orgEntry.name = orgName;
    if (department) orgEntry.units = [{ name: department }];
    body.organizations = {
      [draft.organizationId ?? newContactMapId()]: orgEntry,
    } as ContactCardCreate["organizations"];
  }

  const titleName = draft.title.trim();
  if (titleName) {
    body.titles = {
      [draft.titleId ?? newContactMapId()]: { name: titleName, kind: "title" },
    } as ContactCardCreate["titles"];
  }

  if (draft.notes.trim()) {
    body.notes = {
      [draft.notesId ?? newContactMapId()]: { note: draft.notes.trim() },
    } as ContactCardCreate["notes"];
  }

  const birthday = birthdayEntryFromIso(draft.birthday);
  if (birthday) {
    body.anniversaries = {
      [draft.birthdayId ?? newContactMapId()]: birthday,
    } as ContactCardCreate["anniversaries"];
  }

  return body;
}

/** True when the draft differs from the persisted card (would produce a non-empty patch). */
export function contactEditDraftHasChanges(draft: ContactEditDraft, card: ContactCard): boolean {
  return Object.keys(editDraftToPatch(draft, card)).length > 0;
}
