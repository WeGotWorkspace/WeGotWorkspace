import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
} from "@/contacts-core/src/contacts-types";
import { connectedContacts, getCard } from "@/lib/api/wgw/contacts";
import type { JmapContactCard, SetResponse } from "@/lib/jmap-client";

export type ContactCardSetResponse = {
  created: Record<string, string>;
  updated: Record<string, string>;
  destroyed: string[];
  notCreated: Record<string, { type: string; description: string }>;
  notUpdated: Record<string, { type: string; description: string }>;
  notDestroyed: Record<string, { type: string; description: string }>;
};

export class ContactStateMismatchError extends Error {
  cardId: string;

  constructor(cardId: string, message = "Contact state mismatch") {
    super(message);
    this.cardId = cardId;
  }
}

function setErrorMap(
  errors: Record<string, { type?: string; description?: string } | null> | null | undefined,
): Record<string, { type: string; description: string }> {
  const out: Record<string, { type: string; description: string }> = {};
  for (const [id, err] of Object.entries(errors ?? {})) {
    if (!err) continue;
    out[id] = {
      type: err.type ?? "serverFail",
      description: err.description ?? err.type ?? "Contact/set failed",
    };
  }
  return out;
}

function mapSetResponse(response: SetResponse<JmapContactCard>): ContactCardSetResponse {
  const created: Record<string, string> = {};
  for (const [creationId, record] of Object.entries(response.created ?? {})) {
    const id = record?.id;
    if (typeof id === "string" && id.length > 0) created[creationId] = id;
  }

  const updated: Record<string, string> = {};
  for (const [cardId, record] of Object.entries(response.updated ?? {})) {
    const state =
      record && typeof record === "object" && typeof record.state === "string"
        ? record.state
        : response.newState;
    updated[cardId] = state;
  }

  return {
    created,
    updated,
    destroyed: response.destroyed ?? [],
    notCreated: setErrorMap(response.notCreated),
    notUpdated: setErrorMap(response.notUpdated),
    notDestroyed: setErrorMap(response.notDestroyed),
  };
}

function destroyIds(
  destroy: string[] | Record<string, { ifInState?: string }> | undefined,
): string[] {
  if (!destroy) return [];
  return Array.isArray(destroy) ? destroy : Object.keys(destroy);
}

export async function contactCardSet(
  body: {
    create?: Record<string, ContactCardCreate>;
    update?: Record<string, ContactCardPatch & { ifInState?: string }>;
    destroy?: string[] | Record<string, { ifInState?: string }>;
  },
  _opts?: { signal?: AbortSignal },
): Promise<ContactCardSetResponse> {
  const { contacts, accountId } = await connectedContacts();
  const response = await contacts.setContactCards({
    accountId,
    ...(body.create ? { create: body.create } : {}),
    ...(body.update ? { update: body.update } : {}),
    ...(body.destroy ? { destroy: destroyIds(body.destroy) } : {}),
  });
  return mapSetResponse(response);
}

export function throwOnSetMismatch(
  cardId: string,
  response: ContactCardSetResponse,
  bucket: "notUpdated" | "notDestroyed",
): void {
  const err = response[bucket][cardId];
  if (err?.type === "stateMismatch") {
    throw new ContactStateMismatchError(cardId, err.description);
  }
  if (err) {
    throw new Error(err.description || err.type);
  }
}

export async function patchCardViaSet(
  cardId: string,
  patch: ContactCardPatch,
  opts?: { signal?: AbortSignal; ifInState?: string },
): Promise<{ cardId: string; newState: string }> {
  const updatePayload: ContactCardPatch & { ifInState?: string } = { ...patch };
  if (opts?.ifInState) {
    updatePayload.ifInState = opts.ifInState;
  }
  const response = await contactCardSet(
    { update: { [cardId]: updatePayload } },
    { signal: opts?.signal },
  );
  throwOnSetMismatch(cardId, response, "notUpdated");
  const newState = response.updated[cardId];
  if (!newState) {
    throw new Error("Contact/set update did not return new state");
  }
  return { cardId, newState };
}

export async function deleteCardViaSet(
  cardId: string,
  opts?: { signal?: AbortSignal; ifInState?: string },
): Promise<void> {
  // JMAP destroy is an id list; per-item ifInState is REST-only and dropped.
  void opts?.ifInState;
  const response = await contactCardSet({ destroy: [cardId] }, { signal: opts?.signal });
  if (!response.destroyed.includes(cardId) && response.notDestroyed[cardId]) {
    throwOnSetMismatch(cardId, response, "notDestroyed");
  }
}

export async function createCardViaSet(
  creationId: string,
  body: ContactCardCreate,
  opts?: { signal?: AbortSignal },
): Promise<ContactCard> {
  const response = await contactCardSet(
    { create: { [creationId]: body } },
    { signal: opts?.signal },
  );
  const serverId = response.created[creationId];
  if (!serverId) {
    const err = response.notCreated[creationId];
    throw new Error(err?.description ?? "Contact create failed");
  }
  return getCard(serverId, { signal: opts?.signal });
}
