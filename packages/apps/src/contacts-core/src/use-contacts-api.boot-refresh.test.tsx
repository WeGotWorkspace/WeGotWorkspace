import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { JmapMethodError } from "@/lib/jmap-client";
import {
  readContactsBootstrapFromCache,
  readSyncToken,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { contactsBooksTable, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";

const username = "alice";

const {
  listCards,
  listAddressBooks,
  addressBookChanges,
  contactCardChanges,
  connectedContacts,
  fetchContactsLiveBootstrap,
} = vi.hoisted(() => ({
  listCards: vi.fn(),
  listAddressBooks: vi.fn(),
  addressBookChanges: vi.fn(),
  contactCardChanges: vi.fn(),
  connectedContacts: vi.fn(),
  fetchContactsLiveBootstrap: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return { ...actual, wgwLiveApiEnabled: () => true };
});

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return {
    ...actual,
    listCards,
    listAddressBooks,
    addressBookChanges,
    contactCardChanges,
    connectedContacts,
    fetchContactsLiveBootstrap,
    getCard: vi.fn(),
    getAddressBook: vi.fn(),
  };
});

vi.mock("@/lib/jmap-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jmap-client")>();
  return {
    ...actual,
    JmapContactsAdapter: class {
      initialize() {
        return Promise.resolve();
      }
      startPolling() {}
      stopPolling() {}
    },
  };
});

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
  useOnReconnect: () => undefined,
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { getCard } from "@/lib/api/wgw/contacts";
import { useContactsAPI } from "./use-contacts-api";

const book = {
  id: "default",
  name: "Default",
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
};

function card(id: string): ContactCard {
  return {
    id,
    "@type": "Card",
    version: "1.0",
    uid: `urn:uuid:${id}`,
    addressBookIds: { default: true },
    name: { "@type": "Name", isOrdered: false, full: id },
  } as unknown as ContactCard;
}

const session = {
  ...mockWorkspaceSession,
  user: { ...mockWorkspaceSession.user, username },
};

type BootSnapshot = {
  session: typeof session;
  data: { addressBooks: (typeof book)[]; cards: ContactCard[] };
};

function emptyChanges(since: string, newState: string) {
  return { oldState: since, newState, created: [], updated: [], destroyed: [] };
}

describe("useContactsAPI first visit", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    connectedContacts.mockResolvedValue({
      client: {
        getState: (_accountId: string, type: string) =>
          type === "AddressBook" ? "books-state" : "cards-state",
      },
      accountId: username,
    });
    addressBookChanges.mockImplementation(async (since: string) => {
      if (since === "0:") {
        throw new JmapMethodError("AddressBook/changes", "c0", { type: "cannotCalculateChanges" });
      }
      return emptyChanges(since, "books-state-2");
    });
    contactCardChanges.mockImplementation(async (since: string) => {
      if (since === "0:") {
        throw new JmapMethodError("ContactCard/changes", "c0", { type: "cannotCalculateChanges" });
      }
      return emptyChanges(since, "cards-state-2");
    });
    listCards.mockResolvedValue([]);
    listAddressBooks.mockResolvedValue([book]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
  });

  it("does not full-resync while card pages are still arriving", async () => {
    let resolveBoot: (value: BootSnapshot) => void = () => undefined;
    const boot = new Promise<BootSnapshot>((resolve) => {
      resolveBoot = resolve;
    });
    fetchContactsLiveBootstrap.mockImplementation(
      async (options?: { onProgress?: (partial: BootSnapshot) => void }) => {
        options?.onProgress?.({
          session,
          data: { addressBooks: [book], cards: [card("page-1")] },
        });
        return boot;
      },
    );

    const { result } = renderHook(() => useContactsAPI());

    await waitFor(() => {
      expect(result.current.data.cards.map((row) => row.id)).toEqual(["page-1"]);
    });
    expect(result.current.phase).toBe("ready");
    expect(listCards).not.toHaveBeenCalled();
    expect(listAddressBooks).not.toHaveBeenCalled();
    expect(addressBookChanges).not.toHaveBeenCalled();
    expect(contactCardChanges).not.toHaveBeenCalled();
    expect(await readSyncToken(username, "default")).toBeNull();

    await act(async () => {
      resolveBoot({
        session,
        data: { addressBooks: [book], cards: [card("page-1"), card("page-2")] },
      });
    });

    await waitFor(() => {
      expect(contactCardChanges).toHaveBeenCalledWith("cards-state", undefined);
    });
    expect(addressBookChanges).toHaveBeenCalledWith("books-state", undefined);
    expect(listCards).not.toHaveBeenCalled();
    expect(listAddressBooks).not.toHaveBeenCalled();
  });

  it("stays read-only during a cold download and fetches a page-1 edit on the next changes", async () => {
    let resolveBoot: (
      value: BootSnapshot & {
        syncAnchor: { addressBookState: string; contactCardState: string };
      },
    ) => void = () => undefined;
    const boot = new Promise<
      BootSnapshot & { syncAnchor: { addressBookState: string; contactCardState: string } }
    >((resolve) => {
      resolveBoot = resolve;
    });
    fetchContactsLiveBootstrap.mockImplementation(
      async (options?: { onProgress?: (partial: BootSnapshot) => void }) => {
        options?.onProgress?.({
          session,
          data: { addressBooks: [book], cards: [card("page-1")] },
        });
        return boot;
      },
    );
    connectedContacts.mockResolvedValue({
      client: {
        getState: () => "cards-after-flush",
      },
      accountId: username,
    });
    const updated = {
      ...card("page-1"),
      name: { "@type": "Name", isOrdered: false, full: "Ada Updated" },
    } as ContactCard;
    contactCardChanges.mockImplementation(async (since: string) => {
      if (since === "cards-page-1") {
        return {
          oldState: since,
          newState: "cards-page-2",
          created: [],
          updated: ["page-1"],
          destroyed: [],
        };
      }
      return emptyChanges(since, "cards-ignored");
    });
    vi.mocked(getCard).mockResolvedValue(updated);

    const { result } = renderHook(() => useContactsAPI());

    await waitFor(() => {
      expect(result.current.data.cards.map((row) => row.id)).toEqual(["page-1"]);
    });
    expect(result.current.mutationsLocked).toBe(true);
    expect(result.current.operations).toBeUndefined();
    expect(result.current.listRefreshing).toBe(true);
    expect(result.current.listLoading).toBe(false);

    await act(async () => {
      resolveBoot({
        session,
        data: { addressBooks: [book], cards: [card("page-1"), card("page-2")] },
        syncAnchor: { addressBookState: "books-page-1", contactCardState: "cards-page-1" },
      });
    });

    await waitFor(() => {
      expect(result.current.data.cards.find((row) => row.id === "page-1")?.name?.full).toBe(
        "Ada Updated",
      );
    });
    expect(contactCardChanges).toHaveBeenCalledWith("cards-page-1", undefined);
    expect(contactCardChanges).not.toHaveBeenCalledWith("cards-after-flush", undefined);
    expect(result.current.mutationsLocked).toBe(false);
    expect(result.current.operations).toBeDefined();
    expect(result.current.listRefreshing).toBe(false);
    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards.find((row) => row.id === "page-1")?.name?.full).toBe("Ada Updated");
  });
});
