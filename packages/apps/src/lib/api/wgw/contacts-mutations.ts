import type { ContactsMutationOpts } from "@/lib/models/contacts-types";
import { createCardViaSet, deleteCardViaSet, patchCardViaSet } from "@/lib/api/wgw/contacts-set";
import { getCard } from "@/lib/api/wgw/contacts";

export async function patchCardWithState(
  cardId: string,
  patch: Record<string, unknown>,
  opts?: ContactsMutationOpts & { ifInState?: string },
): Promise<Awaited<ReturnType<typeof getCard>>> {
  const { newState } = await patchCardViaSet(cardId, patch, {
    signal: opts?.signal,
    ifInState: opts?.ifInState,
  });
  const card = await getCard(cardId, { signal: opts?.signal });
  return { ...card, state: newState };
}

export async function deleteCardWithState(
  cardId: string,
  opts?: ContactsMutationOpts & { ifInState?: string },
): Promise<void> {
  await deleteCardViaSet(cardId, {
    signal: opts?.signal,
    ifInState: opts?.ifInState,
  });
}

export async function createCardWithState(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<Awaited<ReturnType<typeof getCard>>> {
  const creationId = `create-${crypto.randomUUID()}`;
  return createCardViaSet(creationId, body as Parameters<typeof createCardViaSet>[1], opts);
}
