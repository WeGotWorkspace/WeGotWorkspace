import type { Dispatch, SetStateAction } from "react";
import type { ReversibleWriteArgs } from "@/hooks/use-queued-mutation";
import { contactMoveAddressBookPatch } from "@/contacts-core/src/contacts-address-book-move";
import {
  groupAddMembersPatch,
  mergeGroupCardPreservingOptimisticMembers,
} from "@/contacts-core/src/contacts-group-utils";
import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsMutationOpts,
} from "@/contacts-core/src/contacts-types";

/**
 * Contacts writes that Undo takes back with a compensating write (#1854). Each builder
 * returns the `execute`/`revert` pair for `queueMutation`, plus an `undo` that rolls the
 * screen back and stops a late `execute` answer from showing the change again.
 *
 * Reverts are deltas: they send back only the members, name or address book the write
 * changed, on the card's current state, so they never wipe an edit made in between.
 */
export type ContactsUndoableWrite = Pick<ReversibleWriteArgs, "execute" | "revert" | "undo">;

/** Puts a saved card into the list; a group keeps members added on this screen. */
export function replaceCardPreservingGroupMembers(
  cards: ContactCard[],
  cardId: string,
  incoming: ContactCard,
): ContactCard[] {
  return cards.map((card) =>
    card.id === cardId ? mergeGroupCardPreservingOptimisticMembers(incoming, card) : card,
  );
}

export function contactMutationOpts(
  card: ContactCard | undefined,
  signal?: AbortSignal,
): ContactsMutationOpts {
  const state = card ? (card as ContactCard & { state?: string }).state : undefined;
  return {
    signal,
    ifInState: state ?? undefined,
    ifMatch: card?.etag,
  };
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 412
  );
}

/** Patches a group on its latest version, and once more on a 412. */
export async function patchGroupWithFreshEtag(
  operations: ContactsAPIOperations,
  groupId: string,
  buildPatch: (freshGroup: ContactCard) => ContactCardPatch | null,
  signal?: AbortSignal,
): Promise<ContactCard> {
  const run = async (): Promise<ContactCard> => {
    const fresh = await operations.getCard(groupId, { signal });
    const patch = buildPatch(fresh);
    if (!patch) return fresh;
    return operations.patchCard(groupId, patch, contactMutationOpts(fresh, signal));
  };

  try {
    return await run();
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    return run();
  }
}

/** The members map that takes a membership patch back: added → removed, removed → added. */
export function invertMembersPatch(patch: ContactCardPatch | null): ContactCardPatch | null {
  const entries = Object.entries(patch?.members ?? {});
  if (entries.length === 0) return null;
  const members: Record<string, boolean> = {};
  for (const [uid, enabled] of entries) members[uid] = !enabled;
  // Removed entries are `false` on the wire, as in `groupRemoveMembersPatch`.
  return { members: members as ContactCardPatch["members"] };
}

type SetCards = Dispatch<SetStateAction<ContactCard[]>>;
type SavedHandler = (saved: ContactCard) => void;

/** Puts a card the server answered with into the list. */
function savedCardToList(setCards: SetCards): SavedHandler {
  return (saved) => setCards((prev) => replaceCardPreservingGroupMembers(prev, saved.id, saved));
}

/** Rolls the screen back once; `isUndone` tells a late answer not to redo the change. */
function undoFlag(rollback: () => void): { undo: () => void; isUndone: () => boolean } {
  let undone = false;
  return {
    undo: () => {
      undone = true;
      rollback();
    },
    isUndone: () => undone,
  };
}

/**
 * Adds or removes group members. Undo sends back exactly the member entries the server
 * applied, on the group's latest version.
 */
export function groupMembersWrite({
  operations,
  groupId,
  buildPatch,
  rollback,
  setCards,
}: {
  operations: ContactsAPIOperations | undefined;
  groupId: string;
  buildPatch: (freshGroup: ContactCard) => ContactCardPatch | null;
  rollback: () => void;
  setCards: SetCards;
}): ContactsUndoableWrite {
  const { undo, isUndone } = undoFlag(rollback);
  const onSaved = savedCardToList(setCards);
  let applied: ContactCardPatch | null = null;
  return {
    undo,
    execute: async (signal) => {
      if (!operations) return;
      const saved = await patchGroupWithFreshEtag(
        operations,
        groupId,
        (fresh) => (applied = buildPatch(fresh)),
        signal,
      );
      if (!isUndone()) onSaved(saved);
    },
    revert: async () => {
      const inverse = invertMembersPatch(applied);
      if (!operations || !inverse) return;
      onSaved(await patchGroupWithFreshEtag(operations, groupId, () => inverse));
    },
  };
}

/** Renames a group. Undo sends the old name back on the group's latest version. */
export function groupRenameWrite({
  operations,
  group,
  name,
  rollback,
  setCards,
}: {
  operations: ContactsAPIOperations | undefined;
  group: ContactCard;
  name: ContactCardPatch["name"];
  rollback: () => void;
  setCards: SetCards;
}): ContactsUndoableWrite {
  const { undo, isUndone } = undoFlag(rollback);
  const onSaved = savedCardToList(setCards);
  const previousName = group.name;
  return {
    undo,
    execute: async (signal) => {
      if (!operations) return;
      const saved = await patchGroupWithFreshEtag(operations, group.id, () => ({ name }), signal);
      if (!isUndone()) onSaved(saved);
    },
    revert: async () => {
      if (!operations || !previousName) return;
      onSaved(await patchGroupWithFreshEtag(operations, group.id, () => ({ name: previousName })));
    },
  };
}

/**
 * Creates a card (a contact or a group), optionally with members or inside a group.
 * Undo takes the membership back and deletes the card once the create has settled, so it
 * knows the server id. A create still queued offline is dropped from the outbox instead
 * (see `deleteCard` in the hybrid operations).
 */
export function cardCreateWrite({
  operations,
  body,
  members = [],
  intoGroupId,
  rollback,
  onCreated,
  setCards,
}: {
  operations: ContactsAPIOperations | undefined;
  body: ContactCardCreate;
  /** Cards to add to the new group. */
  members?: ContactCard[];
  /** Group the new contact joins. */
  intoGroupId?: string;
  rollback: () => void;
  onCreated: (created: ContactCard) => void;
  setCards: SetCards;
}): ContactsUndoableWrite {
  const { undo, isUndone } = undoFlag(rollback);
  const onSaved = savedCardToList(setCards);
  let created: ContactCard | null = null;
  let groupPatch: ContactCardPatch | null = null;
  return {
    undo,
    execute: async (signal, markCompleted) => {
      if (!operations) return;
      const card = await operations.createCard(body, { signal });
      created = card;
      markCompleted(card.id);
      if (!isUndone()) onCreated(card);
      const groupId = intoGroupId ?? (members.length > 0 ? card.id : undefined);
      if (!groupId) return;
      const add = intoGroupId ? [card] : members;
      const saved = await patchGroupWithFreshEtag(
        operations,
        groupId,
        (fresh) => (groupPatch = groupAddMembersPatch(fresh, add)),
        signal,
      );
      if (!isUndone()) onSaved(saved);
    },
    revert: async () => {
      if (!operations || !created) return;
      const inverse = invertMembersPatch(groupPatch);
      if (intoGroupId && inverse) {
        onSaved(await patchGroupWithFreshEtag(operations, intoGroupId, () => inverse));
      }
      await operations.deleteCard(created.id, {});
    },
  };
}

/**
 * Moves a contact to another address book, after taking it out of the groups that stay
 * behind. Undo moves it back, then puts it back into those groups.
 */
export function contactMoveWrite({
  operations,
  card,
  sourceBookId,
  destBookId,
  groupsToDrop,
  buildDropPatch,
  rollback,
  setCards,
}: {
  operations: ContactsAPIOperations | undefined;
  card: ContactCard;
  sourceBookId: string;
  destBookId: string;
  groupsToDrop: ContactCard[];
  buildDropPatch: (freshGroup: ContactCard) => ContactCardPatch | null;
  rollback: () => void;
  setCards: SetCards;
}): ContactsUndoableWrite {
  const { undo, isUndone } = undoFlag(rollback);
  const onSaved = savedCardToList(setCards);
  const dropped = new Map<string, ContactCardPatch | null>();
  let moved = false;
  const apply = (saved: ContactCard) => {
    if (!isUndone()) onSaved(saved);
  };
  return {
    undo,
    execute: async (signal, markCompleted) => {
      if (!operations) return;
      for (const group of groupsToDrop) {
        let patch: ContactCardPatch | null = null;
        const saved = await patchGroupWithFreshEtag(
          operations,
          group.id,
          (fresh) => (patch = buildDropPatch(fresh)),
          signal,
        );
        dropped.set(group.id, patch);
        markCompleted(group.id);
        apply(saved);
      }
      const saved = await operations.patchCard(
        card.id,
        contactMoveAddressBookPatch(sourceBookId, destBookId),
        contactMutationOpts(card, signal),
      );
      moved = true;
      markCompleted(card.id);
      apply(saved);
    },
    revert: async () => {
      if (!operations) return;
      if (moved) {
        // The cached version is the one the move left: no stale state from before it.
        onSaved(
          await operations.patchCard(
            card.id,
            contactMoveAddressBookPatch(destBookId, sourceBookId),
            {},
          ),
        );
      }
      for (const [groupId, patch] of dropped) {
        const inverse = invertMembersPatch(patch);
        if (inverse) onSaved(await patchGroupWithFreshEtag(operations, groupId, () => inverse));
      }
    },
  };
}
