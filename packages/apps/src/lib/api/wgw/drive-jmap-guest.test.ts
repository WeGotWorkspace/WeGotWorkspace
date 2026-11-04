import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guest = vi.hoisted(() => ({ active: true, sharePath: "/users/owner/Drop" as string | null }));
const calls = vi.hoisted(() => ({ paths: [] as string[], methods: [] as unknown[] }));

/** A guest account: the share root is its only top-level node, `sub` sits under it. */
const NODES = [
  { id: "fn-root", parentId: null, name: "Drop", nodeType: "directory" },
  { id: "fn-sub", parentId: "fn-root", name: "sub", nodeType: "directory" },
];

function sessionJson(accountId: string) {
  return {
    capabilities: {
      "urn:ietf:params:jmap:core": { maxSizeUpload: 1000 },
      "urn:ietf:params:jmap:filenode": {},
    },
    accounts: { [accountId]: { name: "Drop", isPersonal: false, accountCapabilities: {} } },
    primaryAccounts: { "urn:ietf:params:jmap:filenode": accountId },
    username: guest.active ? "share:key" : "ada",
    apiUrl: "/api/v1/jmap/guest",
    uploadUrl: "/api/v1/jmap/guest/upload/{accountId}",
    downloadUrl: "/api/v1/jmap/guest/download/{accountId}/{blobId}/{name}",
    state: "s1",
  };
}

function answer(method: string, args: Record<string, unknown>, lastIds: string[]) {
  if (method === "FileNode/query") {
    const filter = args.filter as { isTopLevel?: boolean; parentId?: string; name?: string };
    const ids = NODES.filter((node) =>
      filter.isTopLevel
        ? node.parentId === null
        : node.parentId === filter.parentId && (!filter.name || node.name === filter.name),
    ).map((node) => node.id);
    return { ids, queryState: "q", position: 0, canCalculateChanges: false };
  }
  const ids = (args.ids as string[] | undefined) ?? lastIds;
  return { state: "s", list: NODES.filter((node) => ids.includes(node.id)), notFound: [] };
}

const wgwFetch = vi.hoisted(() =>
  vi.fn(async (path: string, init?: RequestInit) => {
    calls.paths.push(path);
    if (path.endsWith("/jmap/session")) {
      return new Response(JSON.stringify(sessionJson(guest.active ? "guest-abc" : "ada")));
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      methodCalls: [string, Record<string, unknown>, string][];
    };
    let lastIds: string[] = [];
    const methodResponses = body.methodCalls.map(([method, args, id]) => {
      calls.methods.push([method, args]);
      const result = answer(method, args, lastIds) as { ids?: string[] };
      if (result.ids) lastIds = result.ids;
      return [method, result, id];
    });
    return new Response(JSON.stringify({ methodResponses, sessionState: "s1" }));
  }),
);

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch,
  wgwIsGuestSession: () => guest.active,
  wgwGuestSharePath: () => guest.sharePath,
}));

const sharedWithMe = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/api/wgw/drive-shares", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-shares")>()),
  fetchDriveSharedWithMe: sharedWithMe,
}));

const { driveJmapSession, resetDriveJmapSessionForTests, resolveFileNodeId } =
  await import("@/lib/api/wgw/drive-jmap");

describe("driveJmapSession for a share-link guest (#1715)", () => {
  beforeEach(() => {
    resetDriveJmapSessionForTests();
    guest.active = true;
    guest.sharePath = "/users/owner/Drop";
    calls.paths.length = 0;
    calls.methods.length = 0;
    sharedWithMe.mockClear();
  });

  afterEach(() => {
    resetDriveJmapSessionForTests();
  });

  it("resolves folders inside the share from the guest's top-level node", async () => {
    const session = await driveJmapSession();

    expect(session.accountId).toBe("guest-abc");
    expect(session.guestRootPath).toBe("/users/owner/Drop");
    await expect(resolveFileNodeId(session, "/users/owner/Drop", "guest-abc")).resolves.toBe(
      "fn-root",
    );
    await expect(resolveFileNodeId(session, "/users/owner/Drop/sub", "guest-abc")).resolves.toBe(
      "fn-sub",
    );
    // Guests have no shared-with-me list (members only).
    expect(sharedWithMe).not.toHaveBeenCalled();
    const filters = calls.methods
      .filter((call) => (call as [string])[0] === "FileNode/query")
      .map((call) => (call as [string, { filter: unknown }])[1].filter);
    expect(filters).toEqual([{ isTopLevel: true }, { parentId: "fn-root", name: "sub" }]);
  });

  it("does not reuse a member's Session after the tab turns into a guest", async () => {
    guest.active = false;
    const member = await driveJmapSession();
    expect(member.accountId).toBe("ada");
    expect(member.guestRootPath).toBeUndefined();

    guest.active = true;
    const visitor = await driveJmapSession();
    expect(visitor.accountId).toBe("guest-abc");
    expect(calls.paths.filter((path) => path.endsWith("/jmap/session"))).toHaveLength(2);
  });
});
