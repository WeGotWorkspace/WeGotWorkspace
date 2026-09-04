import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import {
  enqueueCoalescedContactUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  readContactsBootstrapFromCache,
  upsertContactCardInCache,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";

const username = "bob";

const bootstrap = {
  session: mockWorkspaceSession,
  data: {
    addressBooks: [
      {
        id: "default",
        name: "Default",
        sortOrder: 0,
        isDefault: true,
        isSubscribed: true,
        isSharee: false,
        myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
      },
    ],
    cards: [
      {
        id: "jane-doe",
        "@type": "Card",
        version: "1.0",
        uid: "urn:uuid:jane",
        addressBookIds: { default: true },
        name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
        state: "state-1",
      } as unknown as ContactCard,
    ],
  },
} satisfies ContactsAppBootstrap;

describe("contacts offline store", () => {
  beforeEach(async () => {
    await writeContactsBootstrapToCache(username, bootstrap);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("reads bootstrap written to cache", async () => {
    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Jane Doe");
  });

  it("orders outbox mutations by createdAt", async () => {
    await enqueueOutboxMutation(username, {
      id: "b",
      domain: CONTACTS_DOMAIN,
      op: "update",
      payload: "{}",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueueOutboxMutation(username, {
      id: "a",
      domain: CONTACTS_DOMAIN,
      op: "update",
      payload: "{}",
    });
    const rows = await listOutboxMutations(username);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("preserves pendingSync cards when bootstrap is rewritten from server", async () => {
    const localCard = {
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Bob Local" },
    } as ContactCard;
    await upsertContactCardInCache(username, localCard, true);

    await writeContactsBootstrapToCache(username, bootstrap);

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Bob Local");
  });

  it("coalesces offline update rows for the same cardId", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane A" } },
      "state-1",
    );
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane B" } },
      "state-1",
    );

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ifInState).toBe("state-1");
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      cardId: string;
      patch: { name?: { full?: string } };
    };
    expect(payload.cardId).toBe("jane-doe");
    expect(payload.patch.name?.full).toBe("Jane B");
  });

  it("coalesces edits to different fields/ids into one patch with the original ifInState", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { emails: { e1: { "@type": "EmailAddress", address: "a@example.com" } } } as never,
      "state-1",
    );
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      {
        phones: { p1: { "@type": "Phone", number: "123" } },
        emails: { e2: { "@type": "EmailAddress", address: "b@example.com" } },
      } as never,
      "state-9",
    );

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    // Original ifInState is preserved across coalescing (later token ignored).
    expect(rows[0]?.ifInState).toBe("state-1");
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      cardId: string;
      patch: {
        emails?: Record<string, unknown>;
        phones?: Record<string, unknown>;
      };
    };
    expect(payload.cardId).toBe("jane-doe");
    expect(Object.keys(payload.patch.emails ?? {})).toEqual(["e1", "e2"]);
    expect(Object.keys(payload.patch.phones ?? {})).toEqual(["p1"]);
  });

  it("preserves a later null delete in the coalesced outbox patch", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { emails: { e1: { "@type": "EmailAddress", address: "a@example.com" } } } as never,
      "state-1",
    );
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { emails: { e1: null } } as never,
      "state-1",
    );

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      patch: { emails?: Record<string, unknown> };
    };
    // The queued server patch must still carry the delete instruction.
    expect(payload.patch.emails).toEqual({ e1: null });
  });

  it("keeps separate update rows for different cardIds", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane" } },
      "state-1",
    );
    await enqueueCoalescedContactUpdate(
      username,
      "other-card",
      { name: { "@type": "Name", isOrdered: false, full: "Other" } },
      "state-2",
    );

    const rows = await listOutboxMutations(username);
    expect(rows).toHaveLength(2);
  });
});
