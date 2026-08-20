import type {
  AddressBook,
  ContactCard,
  ContactCardImportResponse,
} from "@wgw-api-generated/contacts-types";
import { contactCardToVCard } from "@/contacts-core/src/contacts-vcard-export";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { wgwApiBaseUrl, wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import {
  CONTACTS_CAPABILITY,
  JmapClient,
  JmapContactsClient,
  JmapMethodError,
  type ChangesResponse,
  type JmapAddressBook,
  type JmapContactCard,
} from "@/lib/jmap-client";

export class ContactsRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * JmapClient fetches sessionUrl and the session's absolute apiUrl verbatim;
 * this bridge routes both through wgwFetch (bearer + refresh) by reducing the
 * URL back to an API-relative path.
 */
function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function interpolateJmapUrl(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(vars[key] ?? ""));
}

let cachedClient: JmapClient | null = null;

export function createContactsJmapClient(): JmapClient {
  return new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: (input, init) => wgwFetch(toApiRelativePath(input), init ?? {}),
  });
}

export function contactsJmapClient(): JmapClient {
  if (!cachedClient) {
    cachedClient = createContactsJmapClient();
  }
  return cachedClient;
}

/** Test-only: drop the memoized client (and its session). */
export function resetContactsJmapClientForTests(): void {
  cachedClient = null;
}

export async function connectedContacts(client: JmapClient = contactsJmapClient()): Promise<{
  contacts: JmapContactsClient;
  accountId: string;
  client: JmapClient;
}> {
  if (!client.isConnected) {
    await client.connect();
  }
  return {
    contacts: new JmapContactsClient(client),
    accountId: client.primaryAccountId(CONTACTS_CAPABILITY),
    client,
  };
}

export function isCannotCalculateChanges(error: unknown): boolean {
  return error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges";
}

function toAddressBook(book: JmapAddressBook): AddressBook {
  return book as AddressBook;
}

function toContactCard(card: JmapContactCard): ContactCard {
  return card as ContactCard;
}

export async function listAddressBooks(_opts?: { signal?: AbortSignal }): Promise<AddressBook[]> {
  const { contacts, accountId } = await connectedContacts();
  const response = await contacts.getAddressBooks(accountId);
  return response.list.map(toAddressBook);
}

export async function getAddressBook(
  addressBookId: string,
  _opts?: { signal?: AbortSignal },
): Promise<AddressBook> {
  const { contacts, accountId } = await connectedContacts();
  const response = await contacts.getAddressBooks(accountId, [addressBookId]);
  const book = response.list[0];
  if (!book) {
    throw new ContactsRequestError(`AddressBook/get did not return ${addressBookId}`, 404);
  }
  return toAddressBook(book);
}

export async function listCards(opts?: {
  addressBookId?: string;
  signal?: AbortSignal;
}): Promise<ContactCard[]> {
  const { contacts, accountId } = await connectedContacts();
  const response = await contacts.getContactCardsByQuery(
    accountId,
    opts?.addressBookId ? { inAddressBook: opts.addressBookId } : undefined,
  );
  return response.list.map(toContactCard);
}

export async function getCard(
  cardId: string,
  _opts?: { signal?: AbortSignal },
): Promise<ContactCard> {
  const { contacts, accountId } = await connectedContacts();
  const response = await contacts.getContactCards(accountId, [cardId]);
  const card = response.list[0];
  if (!card) {
    throw new ContactsRequestError(`ContactCard/get did not return ${cardId}`, 404);
  }
  return toContactCard(card);
}

export async function addressBookChanges(
  sinceState: string,
  _opts?: { signal?: AbortSignal },
): Promise<ChangesResponse> {
  const { contacts, accountId } = await connectedContacts();
  return contacts.addressBookChanges(accountId, sinceState);
}

export async function contactCardChanges(
  sinceState: string,
  _opts?: { signal?: AbortSignal },
): Promise<ChangesResponse> {
  const { contacts, accountId } = await connectedContacts();
  return contacts.contactCardChanges(accountId, sinceState);
}

export async function downloadContactBlob(
  blobId: string,
  opts?: { name?: string; type?: string; signal?: AbortSignal },
): Promise<Response> {
  const { client, accountId } = await connectedContacts();
  const path = interpolateJmapUrl(client.session.downloadUrl, {
    accountId,
    blobId,
    name: opts?.name ?? "photo",
    type: opts?.type ?? "application/octet-stream",
  });
  return wgwFetch(toApiRelativePath(path), { method: "GET", signal: opts?.signal });
}

export async function uploadContactBlob(
  body: Blob,
  opts?: { type?: string; signal?: AbortSignal },
): Promise<{ blobId: string; size: number; type: string }> {
  const { client, accountId } = await connectedContacts();
  const path = interpolateJmapUrl(client.session.uploadUrl, { accountId });
  const contentType = opts?.type ?? body.type ?? "application/octet-stream";
  const res = await wgwFetch(toApiRelativePath(path), {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new ContactsRequestError(`POST /jmap/upload failed (${res.status})`, res.status);
  }
  return (await wgwReadJson(res)) as { blobId: string; size: number; type: string };
}

/** Client-side JSContact → vCard. Does not call GET …/vcf. */
export async function downloadCardVcf(
  cardId: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const card = await getCard(cardId, opts);
  return contactCardToVCard(card);
}

export async function importVcards(
  vcardText: string,
  opts?: { addressBookId: string; signal?: AbortSignal },
): Promise<ContactCardImportResponse> {
  if (!opts?.addressBookId) {
    throw new ContactsRequestError("addressBookId is required for vCard import", 400);
  }
  const query = `?addressBookId=${encodeURIComponent(opts.addressBookId)}`;
  const res = await wgwFetch(`/contacts/cards/import${query}`, {
    method: "POST",
    headers: { "Content-Type": "text/vcard" },
    body: vcardText,
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new ContactsRequestError(
      `POST /contacts/cards/import failed (${res.status})`,
      res.status,
    );
  }
  return (await wgwReadJson(res)) as ContactCardImportResponse;
}

/** Load address books and cards from the configured WeGotWorkspace API. */
export async function fetchContactsLiveBootstrap(): Promise<ContactsAppBootstrap> {
  const session = await wgwFetchPrincipal();

  const settingsRes = await wgwFetch("/settings/state");
  if (settingsRes.ok) {
    const settings = (await wgwReadJson(settingsRes)) as {
      apps?: { contacts?: boolean };
    };
    if (settings.apps?.contacts === false) {
      throw new Error("CONTACTS_SETTINGS_MISSING");
    }
  }

  const { contacts, accountId } = await connectedContacts();
  const { books, cards } = await contacts.getAddressBooksAndCards(accountId);

  return {
    data: {
      addressBooks: books.list.map(toAddressBook),
      cards: cards.list.map(toContactCard),
    },
    session,
  };
}
