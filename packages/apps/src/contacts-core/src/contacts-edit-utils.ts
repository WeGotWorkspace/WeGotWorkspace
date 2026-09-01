import { enabledAddressBookIds } from "@/contacts-core/src/contacts-addressbook-color";
import {
  mapEntriesSorted,
  synthesizeNameFromComponents,
} from "@/contacts-core/src/contacts-display-utils";
import { canWriteContactGroup } from "@/contacts-core/src/contacts-group-utils";
import type {
  AddressBook,
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
} from "@/contacts-core/src/contacts-types";

export const CONTACTS_CREATE_ID = "__contacts_create__";

/** JSContact channel context values exposed in the edit UI (maps to `contexts` on phones/emails/addresses/links). */
export const CONTACT_CHANNEL_CONTEXTS = ["", "home", "work", "school"] as const;
export type ContactChannelContext = (typeof CONTACT_CHANNEL_CONTEXTS)[number];

/** New empty channel row default: Home → JSContact `contexts.private` (vCard HOME). */
export const CONTACT_CHANNEL_DEFAULT_CONTEXT = "home" satisfies ContactChannelContext;

/**
 * Phone type select values. Contexts (`home`/`work`/`school`) map to JSContact `contexts`
 * (vCard TYPE=HOME/WORK/…). `mobile` maps to JSContact `features.mobile` (vCard TYPE=CELL).
 */
export const CONTACT_PHONE_TYPES = ["", "mobile", "home", "work", "school"] as const;
export type ContactPhoneType = (typeof CONTACT_PHONE_TYPES)[number];

export type ContactAddressDraft = {
  id: string;
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
  contextType: ContactChannelContext;
};

export type ContactEditDraft = {
  nameGiven: string;
  nameGiven2: string;
  nameSurname: string;
  showGiven2: boolean;
  showAsCompany: boolean;
  phones: Array<{ id: string; number: string; phoneType: ContactPhoneType }>;
  emails: Array<{ id: string; address: string; contextType: ContactChannelContext }>;
  addresses: ContactAddressDraft[];
  urls: Array<{ id: string; uri: string; contextType: ContactChannelContext }>;
  /** JSContact `titles` entry with kind "title" (vCard TITLE). */
  title: string;
  titleId?: string;
  /** JSContact `organizations[].units[0].name` (vCard ORG unit / department). */
  department: string;
  organization: string;
  notes: string;
  organizationId?: string;
  notesId?: string;
};

let contactIdCounter = 0;

function fromCryptoRandomValues(): string | null {
  if (typeof crypto === "undefined" || !("getRandomValues" in crypto)) {
    return null;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newContactMapId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const randomFromCrypto = fromCryptoRandomValues();
  if (randomFromCrypto) {
    return randomFromCrypto;
  }
  contactIdCounter += 1;
  return `contact-${Date.now().toString(36)}-${contactIdCounter.toString(36)}`;
}

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
  const defaultBook = addressBooks.find((book) => book.isDefault) ?? addressBooks[0];
  if (!defaultBook) {
    throw new Error("No address book available for create");
  }
  return { [defaultBook.id]: true };
}

/** New contact is allowed on writable books and writable group views. */
export function canCreateContactInView(
  view: string,
  addressBooks: readonly Pick<AddressBook, "id" | "myRights">[],
  selectedGroup?: Pick<ContactCard, "addressBookIds"> | null,
  hasOperations = false,
): boolean {
  if (view.startsWith("group:")) {
    return canWriteContactGroup(selectedGroup, addressBooks, hasOperations);
  }
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
  };
}

export function readContactContext(
  contexts?: Record<string, boolean | undefined>,
): ContactChannelContext {
  if (contexts?.work) return "work";
  if (contexts?.private || contexts?.home) return "home";
  if (contexts?.school) return "school";
  return "";
}

export function contactContextToPatch(
  contextType: ContactChannelContext,
): Record<string, true> | undefined {
  if (contextType === "work") return { work: true };
  if (contextType === "home") return { private: true };
  if (contextType === "school") return { school: true };
  return undefined;
}

/** Prefer `features.mobile` (vCard CELL); otherwise fall back to channel contexts. */
export function readPhoneType(
  phone:
    | {
        contexts?: Record<string, boolean | undefined>;
        features?: Record<string, boolean | undefined>;
      }
    | null
    | undefined,
): ContactPhoneType {
  if (phone?.features?.mobile) return "mobile";
  return readContactContext(phone?.contexts);
}

export function phoneTypeToPatch(phoneType: ContactPhoneType): {
  contexts?: Record<string, true> | null;
  features?: Record<string, true> | null;
} {
  if (phoneType === "mobile") {
    return { features: { mobile: true }, contexts: null };
  }
  const contexts = contactContextToPatch(phoneType);
  return {
    contexts: contexts ?? null,
    features: null,
  };
}

function readPhoneNumber(phone: NonNullable<ContactCard["phones"]>[string]): string {
  if (typeof phone.number === "string") return phone.number.trim();
  if (typeof phone.uri === "string") return phone.uri.trim();
  return "";
}

function readAddressComponent(
  components: NonNullable<ContactCard["addresses"]>[string]["components"],
  kind: string,
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function readAddressStreet(address: NonNullable<ContactCard["addresses"]>[string]): string {
  const components = address.components ?? [];
  const name = readAddressComponent(components, "name");
  const number = readAddressComponent(components, "number");
  if (number && name) return `${number} ${name}`.trim();
  if (name) return name;
  if (number) return number;
  if (typeof address.full === "string" && address.full.trim()) {
    return address.full.trim();
  }
  return "";
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
  if (draft.phones.some((row) => row.number.trim())) return true;
  if (draft.emails.some((row) => row.address.trim())) return true;
  if (draft.urls.some((row) => row.uri.trim())) return true;
  if (draft.addresses.some(addressDraftHasContent)) return true;
  return false;
}

function addressDraftToComponents(
  row: ContactAddressDraft,
): Array<{ kind: string; value: string }> {
  const components: Array<{ kind: string; value: string }> = [];
  const street = row.street.trim();
  const locality = row.locality.trim();
  const region = row.region.trim();
  const postalCode = row.postalCode.trim();
  const country = row.country.trim();
  if (street) components.push({ kind: "name", value: street });
  if (locality) components.push({ kind: "locality", value: locality });
  if (region) components.push({ kind: "region", value: region });
  if (postalCode) components.push({ kind: "postcode", value: postalCode });
  if (country) components.push({ kind: "country", value: country });
  return components;
}

function addressDraftToPatchValue(row: ContactAddressDraft): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    components: addressDraftToComponents(row),
    isOrdered: false,
  };
  const contexts = contactContextToPatch(row.contextType);
  if (contexts) entry.contexts = contexts;
  return entry;
}

function componentValue(
  components: NonNullable<ContactCard["name"]>["components"],
  kind: "given" | "given2" | "surname" | "surname2",
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value.trim())
    .filter(Boolean)
    .join(" ");
}

function splitFullName(fullName: string): { given: string; surname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      given: parts.slice(0, -1).join(" "),
      surname: parts[parts.length - 1] ?? "",
    };
  }
  return { given: fullName.trim(), surname: "" };
}

function phoneValue(
  card: ContactCard,
  id: string,
): { number: string; phoneType: ContactPhoneType } {
  const phone = card.phones?.[id];
  if (!phone) return { number: "", phoneType: "" };
  return {
    number: readPhoneNumber(phone),
    phoneType: readPhoneType(phone),
  };
}

function emailValue(
  card: ContactCard,
  id: string,
): { address: string; contextType: ContactChannelContext } {
  const email = card.emails?.[id];
  return {
    address: email?.address?.trim() ?? "",
    contextType: readContactContext(email?.contexts),
  };
}

function addressValue(card: ContactCard, id: string): ContactAddressDraft {
  const address = card.addresses?.[id];
  if (!address) {
    return {
      id,
      street: "",
      locality: "",
      region: "",
      postalCode: "",
      country: "",
      contextType: "",
    };
  }
  const components = address.components ?? [];
  return {
    id,
    street: readAddressStreet(address),
    locality: readAddressComponent(components, "locality"),
    region: readAddressComponent(components, "region"),
    postalCode: readAddressComponent(components, "postcode"),
    country: readAddressComponent(components, "country"),
    contextType: readContactContext(address.contexts),
  };
}

export function contactCardToEditDraft(card: ContactCard): ContactEditDraft {
  const components = card.name?.components ?? [];
  let nameGiven = componentValue(components, "given");
  const nameGiven2 = componentValue(components, "given2");
  let nameSurname = componentValue(components, "surname");
  const fullName = card.name?.full?.trim() ?? "";

  if (!nameGiven && !nameGiven2 && !nameSurname && fullName) {
    const split = splitFullName(fullName);
    nameGiven = split.given;
    nameSurname = split.surname;
  }

  const [organizationId, organizationEntry] = mapEntriesSorted(card.organizations)[0] ?? [];
  const [notesId, notesEntry] = mapEntriesSorted(card.notes)[0] ?? [];
  const titleEntry =
    mapEntriesSorted(card.titles).find(([, entry]) => (entry.kind ?? "title") === "title") ??
    mapEntriesSorted(card.titles)[0];
  const [titleId, titleValue] = titleEntry ?? [];

  return {
    nameGiven,
    nameGiven2,
    nameSurname,
    showGiven2: Boolean(nameGiven2),
    phones: mapEntriesSorted(card.phones).map(([id, phone]) => ({
      id,
      number: readPhoneNumber(phone),
      phoneType: readPhoneType(phone),
    })),
    emails: mapEntriesSorted(card.emails).map(([id, email]) => ({
      id,
      address: email.address?.trim() ?? "",
      contextType: readContactContext(email.contexts),
    })),
    addresses: mapEntriesSorted(card.addresses).map(([id]) => ({
      ...addressValue(card, id),
    })),
    urls: mapEntriesSorted(card.links)
      .filter(([, link]) => link.kind !== "contact")
      .map(([id, link]) => ({
        id,
        uri: link.uri?.trim() ?? "",
        contextType: readContactContext(link.contexts),
      })),
    showAsCompany: card.kind === "org",
    title: titleValue?.name?.trim() ?? "",
    titleId,
    department: organizationEntry?.units?.[0]?.name?.trim() ?? "",
    organization: organizationEntry?.name?.trim() ?? "",
    organizationId,
    notes: notesEntry?.note?.trim() ?? "",
    notesId,
  };
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

  return body;
}

function currentNameComponents(card: ContactCard): {
  given: string;
  given2: string;
  surname: string;
  full: string;
} {
  const components = card.name?.components ?? [];
  return {
    given: componentValue(components, "given"),
    given2: componentValue(components, "given2"),
    surname: componentValue(components, "surname"),
    full: card.name?.full?.trim() ?? "",
  };
}

function patchName(
  draft: ContactEditDraft,
  active: ContactCard,
): ContactCardPatch["name"] | undefined {
  const next = buildNameFromDraft(draft);
  const current = currentNameComponents(active);

  const draftGiven = draft.nameGiven.trim();
  const draftGiven2 = draft.nameGiven2.trim();
  const draftSurname = draft.nameSurname.trim();

  if (!next && !current.given && !current.given2 && !current.surname && !current.full) {
    return undefined;
  }

  const componentsChanged =
    current.given !== draftGiven ||
    current.given2 !== draftGiven2 ||
    current.surname !== draftSurname;

  if (!componentsChanged && !current.full) return undefined;

  if (!componentsChanged && current.full) {
    const split = splitFullName(current.full);
    if (split.given === draftGiven && split.surname === draftSurname && !draftGiven2) {
      return undefined;
    }
  }

  if (next) return next;

  return { isOrdered: false, components: [] } as unknown as ContactCardPatch["name"];
}

function patchChannelMapField<T extends Record<string, unknown | null>, Row extends { id: string }>(
  activeIds: Set<string>,
  draftRows: Row[],
  readRow: (id: string) => { value: string; type: string },
  getValue: (row: Row) => string,
  getType: (row: Row) => string,
  toPatchValue: (row: Row) => unknown,
): T | undefined {
  const patch = {} as T;
  let changed = false;

  for (const id of activeIds) {
    if (!draftRows.some((row) => row.id === id)) {
      (patch as Record<string, unknown | null>)[id] = null;
      changed = true;
    }
  }

  for (const row of draftRows) {
    const value = getValue(row).trim();
    if (!value) {
      if (activeIds.has(row.id)) {
        (patch as Record<string, unknown | null>)[row.id] = null;
        changed = true;
      }
      continue;
    }
    const current = readRow(row.id);
    if (current.value !== value || current.type !== getType(row)) {
      (patch as Record<string, unknown>)[row.id] = toPatchValue(row);
      changed = true;
    }
  }

  return changed ? patch : undefined;
}

export function editDraftToPatch(draft: ContactEditDraft, active: ContactCard): ContactCardPatch {
  const patch: ContactCardPatch = {};

  const name = patchName(draft, active);
  if (name) patch.name = name;

  const activePhoneIds = new Set(mapEntriesSorted(active.phones).map(([id]) => id));
  const phones = patchChannelMapField<
    NonNullable<ContactCardPatch["phones"]>,
    ContactEditDraft["phones"][number]
  >(
    activePhoneIds,
    draft.phones,
    (id) => {
      const phone = phoneValue(active, id);
      return { value: phone.number, type: phone.phoneType };
    },
    (row) => row.number,
    (row) => row.phoneType,
    (row) => {
      const entry: Record<string, unknown> = { number: row.number.trim() };
      const typed = phoneTypeToPatch(row.phoneType);
      entry.contexts = typed.contexts;
      entry.features = typed.features;
      return entry;
    },
  );
  if (phones) patch.phones = phones;

  const activeEmailIds = new Set(mapEntriesSorted(active.emails).map(([id]) => id));
  const emails = patchChannelMapField<
    NonNullable<ContactCardPatch["emails"]>,
    ContactEditDraft["emails"][number]
  >(
    activeEmailIds,
    draft.emails,
    (id) => {
      const email = emailValue(active, id);
      return { value: email.address, type: email.contextType };
    },
    (row) => row.address,
    (row) => row.contextType,
    (row) => {
      const entry: Record<string, unknown> = { address: row.address.trim() };
      const contexts = contactContextToPatch(row.contextType);
      if (contexts) entry.contexts = contexts;
      return entry;
    },
  );
  if (emails) patch.emails = emails;

  const activeAddressIds = new Set(mapEntriesSorted(active.addresses).map(([id]) => id));
  const addresses = patchChannelMapField<
    NonNullable<ContactCardPatch["addresses"]>,
    ContactEditDraft["addresses"][number]
  >(
    activeAddressIds,
    draft.addresses,
    (id) => {
      const address = addressValue(active, id);
      return {
        value: [
          address.street,
          address.locality,
          address.region,
          address.postalCode,
          address.country,
        ]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\0"),
        type: address.contextType,
      };
    },
    (row) =>
      [row.street, row.locality, row.region, row.postalCode, row.country]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\0"),
    (row) => row.contextType,
    (row) => addressDraftToPatchValue(row),
  );
  if (addresses) patch.addresses = addresses;

  const activeUrlIds = new Set(
    mapEntriesSorted(active.links)
      .filter(([, link]) => link.kind !== "contact")
      .map(([id]) => id),
  );
  const urls = patchChannelMapField<
    NonNullable<ContactCardPatch["links"]>,
    ContactEditDraft["urls"][number]
  >(
    activeUrlIds,
    draft.urls,
    (id) => {
      const link = active.links?.[id];
      return {
        value: link?.uri?.trim() ?? "",
        type: readContactContext(link?.contexts),
      };
    },
    (row) => row.uri,
    (row) => row.contextType,
    (row) => {
      const entry: Record<string, unknown> = { uri: row.uri.trim() };
      const contexts = contactContextToPatch(row.contextType);
      if (contexts) entry.contexts = contexts;
      return entry;
    },
  );
  if (urls) patch.links = urls;

  // Group kind is managed separately (rename dialog, CardDAV); the edit form only
  // controls org vs individual via the showAsCompany toggle, so never overwrite "group".
  if (active.kind !== "group") {
    const nextKind = draft.showAsCompany ? "org" : "individual";
    const currentKind = active.kind ?? "individual";
    if (nextKind !== currentKind) {
      patch.kind = nextKind;
    }
  }

  const [activeOrgId, activeOrg] = mapEntriesSorted(active.organizations)[0] ?? [];
  const orgName = draft.organization.trim();
  const department = draft.department.trim();
  const currentOrgName = activeOrg?.name?.trim() ?? "";
  const currentDepartment = activeOrg?.units?.[0]?.name?.trim() ?? "";
  if (orgName !== currentOrgName || department !== currentDepartment) {
    if (!orgName && !department && activeOrgId) {
      patch.organizations = { [activeOrgId]: null } as unknown as ContactCardPatch["organizations"];
    } else if (orgName || department) {
      const orgId = draft.organizationId ?? activeOrgId ?? newContactMapId();
      const remainingUnits = (activeOrg?.units ?? []).slice(1);
      const orgEntry: Record<string, unknown> = {};
      if (orgName) orgEntry.name = orgName;
      if (department) {
        orgEntry.units = [{ name: department }, ...remainingUnits];
      } else if (remainingUnits.length > 0) {
        orgEntry.units = remainingUnits;
      } else if (currentDepartment) {
        orgEntry.units = null;
      }
      if (!orgName && currentOrgName) {
        orgEntry.name = null;
      }
      patch.organizations = {
        [orgId]: orgEntry,
      } as ContactCardPatch["organizations"];
    }
  }

  const titleEntry =
    mapEntriesSorted(active.titles).find(([, entry]) => (entry.kind ?? "title") === "title") ??
    mapEntriesSorted(active.titles)[0];
  const [activeTitleId, activeTitle] = titleEntry ?? [];
  const titleName = draft.title.trim();
  const currentTitleName = activeTitle?.name?.trim() ?? "";
  if (titleName !== currentTitleName) {
    if (!titleName && activeTitleId) {
      patch.titles = { [activeTitleId]: null } as unknown as ContactCardPatch["titles"];
    } else if (titleName) {
      patch.titles = {
        [draft.titleId ?? activeTitleId ?? newContactMapId()]: {
          name: titleName,
          kind: "title",
        },
      } as ContactCardPatch["titles"];
    }
  }

  const [activeNoteId, activeNote] = mapEntriesSorted(active.notes)[0] ?? [];
  const noteText = draft.notes.trim();
  const currentNoteText = activeNote?.note?.trim() ?? "";
  if (noteText !== currentNoteText) {
    if (!noteText && activeNoteId) {
      patch.notes = { [activeNoteId]: null } as unknown as ContactCardPatch["notes"];
    } else if (noteText) {
      patch.notes = {
        [draft.notesId ?? activeNoteId ?? newContactMapId()]: { note: noteText },
      } as ContactCardPatch["notes"];
    }
  }

  return patch;
}

/** True when the draft differs from the persisted card (would produce a non-empty patch). */
export function contactEditDraftHasChanges(draft: ContactEditDraft, card: ContactCard): boolean {
  return Object.keys(editDraftToPatch(draft, card)).length > 0;
}
