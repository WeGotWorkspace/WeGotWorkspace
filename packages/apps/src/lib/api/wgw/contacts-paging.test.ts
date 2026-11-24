import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONTACTS = "urn:ietf:params:jmap:contacts";
const CORE = "urn:ietf:params:jmap:core";

const { wgwFetch, acquire, log } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  acquire: vi.fn(),
  /** Every ContactCard/get page and pacer turn, in order. */
  log: [] as string[],
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return {
    ...actual,
    wgwApiBaseUrl: () => "/api/v1",
    wgwFetch,
    wgwFetchPrincipal: vi.fn(async () => ({ user: { username: "bob" } })),
    wgwSettingsStateRead: {
      read: vi.fn(async () => ({ ok: true, status: 200, json: { apps: { contacts: true } } })),
    },
  };
});

vi.mock("@/lib/offline/core/background-sync-pacer", () => ({
  backgroundSyncPacer: () => ({ acquire }),
}));

import {
  fetchContactCardPages,
  fetchContactsLiveBootstrap,
  resetContactsJmapClientForTests,
} from "@/lib/api/wgw/contacts";

type Invocation = [string, Record<string, unknown>, string];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const session = {
  capabilities: { [CORE]: { maxObjectsInGet: 500 }, [CONTACTS]: {} },
  accounts: { bob: { name: "bob", isPersonal: true, isReadOnly: false, accountCapabilities: {} } },
  primaryAccounts: { [CONTACTS]: "bob" },
  username: "bob",
  apiUrl: "/api/v1/jmap/api",
  downloadUrl: "/api/v1/jmap/download/{accountId}/{blobId}/{name}?type={type}",
  uploadUrl: "/api/v1/jmap/upload/{accountId}",
  eventSourceUrl: "/api/v1/jmap/eventsource",
  state: "s1",
};

/** A JMAP server with `ids` cards, answering the first download's batch and pages. */
function serveCards(ids: string[]) {
  wgwFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/settings/state") return json({ apps: { contacts: true } });
    if (path === "/jmap/session") return json(session);
    const { methodCalls } = JSON.parse(String(init?.body)) as { methodCalls: Invocation[] };
    const methodResponses = methodCalls.map(([name, args, id]): Invocation => {
      if (name === "AddressBook/get") return [name, { state: "b1", list: [], notFound: [] }, id];
      if (name === "ContactCard/query") {
        return [name, { ids: args.filter ? [] : ids }, id];
      }
      const pageIds = (args.ids as string[]) ?? [];
      if (pageIds.length) log.push(`get ${pageIds.length}`);
      return [
        name,
        { state: "c1", list: pageIds.map((cardId) => ({ id: cardId })), notFound: [] },
        id,
      ];
    });
    return json({ methodResponses, sessionState: "s1" });
  });
}

const cardIds = (count: number) => Array.from({ length: count }, (_, index) => `card-${index}`);

describe("contacts first download pacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    log.length = 0;
    acquire.mockImplementation(async (_signal?: AbortSignal, priority?: string) => {
      log.push(`slot ${priority}`);
    });
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    resetContactsJmapClientForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetContactsJmapClientForTests();
  });

  it("sends the first page at once and takes a first-priority slot before every later page", async () => {
    serveCards(cardIds(450));

    await fetchContactsLiveBootstrap();

    expect(log).toEqual(["get 200", "slot first", "get 200", "slot first", "get 50"]);
  });

  it("paces every page after the first request of a resumed download", async () => {
    serveCards([]);
    const pages: number[] = [];

    await fetchContactCardPages(cardIds(410), ({ cards }) => {
      pages.push(cards.length);
    });

    expect(pages).toEqual([200, 200, 10]);
    expect(log).toEqual(["get 200", "slot first", "get 200", "slot first", "get 10"]);
  });

  it("takes no slot for an address book that fits in one page", async () => {
    serveCards(cardIds(12));

    await fetchContactsLiveBootstrap();

    expect(log).toEqual(["get 12"]);
    expect(acquire).not.toHaveBeenCalled();
  });
});
