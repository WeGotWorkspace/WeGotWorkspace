import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDARS_CAPABILITY,
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  type JmapRequest,
} from "@/lib/jmap-client";

const { wgwFetch, wgwReadJson, wgwIsGuestSession, wgwGuestSharePath, wgwFetchPrincipal } =
  vi.hoisted(() => ({
    wgwFetch: vi.fn(),
    wgwReadJson: vi.fn(),
    wgwIsGuestSession: vi.fn(() => false),
    wgwGuestSharePath: vi.fn(() => null as string | null),
    wgwFetchPrincipal: vi.fn(),
  }));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch,
  wgwReadJson,
  wgwIsGuestSession,
  wgwApiBaseUrl: () => "/api/v1",
  wgwErrorMessageFromBody: (_body: string, status: number) => String(status),
  wgwFetchPrincipal,
  wgwEnsurePluginSession: vi.fn(),
  wgwGuestSharePath,
}));

vi.mock("@/lib/api/wgw/plugins", () => ({
  fetchWgwPlugins: vi.fn(async () => []),
}));

vi.mock("@/lib/api/wgw/search", () => ({
  downloadWgwUnifiedSearchRecord: vi.fn(),
}));

import {
  createWgwDriveOperations,
  fetchDriveLiveBootstrap,
  resetDriveJmapSessionForTests,
} from "@/lib/api/wgw/drive";

const ACCOUNT_ID = "bob";
const HOME_ID = "fn-home";
const DOCS_ID = "fn-docs";
const FILE_ID = "fn-readme";

function jmapSessionBody() {
  return {
    capabilities: {
      [CORE_CAPABILITY]: { maxSizeUpload: 25_000_000 },
      [CALENDARS_CAPABILITY]: {},
      [FILENODE_CAPABILITY]: {},
    },
    accounts: {
      [ACCOUNT_ID]: {
        name: ACCOUNT_ID,
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [FILENODE_CAPABILITY]: {} },
      },
    },
    primaryAccounts: {
      [CALENDARS_CAPABILITY]: ACCOUNT_ID,
      [FILENODE_CAPABILITY]: ACCOUNT_ID,
    },
    username: ACCOUNT_ID,
    apiUrl: "/jmap",
    downloadUrl: "/jmap/download/{accountId}/{blobId}/{name}?type={type}",
    uploadUrl: "/jmap/upload/{accountId}",
    eventSourceUrl: "/jmap/eventsource",
    state: "1",
  };
}

function homeNode() {
  return {
    id: HOME_ID,
    parentId: null,
    nodeType: "directory",
    blobId: null,
    name: ACCOUNT_ID,
    size: null,
    type: null,
    myRights: {
      mayRead: true,
      mayAddChildren: true,
      mayRename: true,
      mayDelete: true,
      mayModifyContent: true,
      mayShare: false,
    },
  };
}

function docsNode() {
  return {
    id: DOCS_ID,
    parentId: HOME_ID,
    nodeType: "directory",
    blobId: null,
    name: "Docs",
    size: null,
    type: null,
  };
}

function fileNode() {
  return {
    id: FILE_ID,
    parentId: HOME_ID,
    nodeType: "file",
    blobId: "fnb-fn-readme-aaaaaaaa",
    name: "readme.md",
    size: 12,
    type: "text/markdown",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function handleJmap(body: JmapRequest) {
  const byId = new Map<
    string,
    ReturnType<typeof homeNode> | ReturnType<typeof docsNode> | ReturnType<typeof fileNode>
  >([
    [HOME_ID, homeNode()],
    [DOCS_ID, docsNode()],
    [FILE_ID, fileNode()],
  ]);
  let lastQueryIds: string[] = [];
  const responses = body.methodCalls.map(([name, args, id]) => {
    if (name === "FileNode/query") {
      const filter = (args.filter ?? {}) as {
        isTopLevel?: boolean;
        parentId?: string;
        name?: string;
      };
      let ids: string[] = [];
      if (filter.isTopLevel) ids = [HOME_ID];
      else if (filter.parentId === HOME_ID && filter.name === "Docs") ids = [DOCS_ID];
      else if (filter.parentId === HOME_ID && filter.name === "readme.md") ids = [FILE_ID];
      else if (filter.parentId === HOME_ID) ids = [DOCS_ID, FILE_ID];
      lastQueryIds = ids;
      return [name, { accountId: ACCOUNT_ID, ids, queryState: "1" }, id];
    }
    if (name === "FileNode/get") {
      const requested = Array.isArray(args.ids)
        ? (args.ids as string[])
        : args["#ids"]
          ? lastQueryIds
          : [...byId.keys()];
      const list = requested.map((nodeId) => byId.get(nodeId)).filter(Boolean);
      return [name, { accountId: ACCOUNT_ID, state: "1", list, notFound: [] }, id];
    }
    if (name === "FileNode/set") {
      return [
        name,
        {
          accountId: ACCOUNT_ID,
          newState: "2",
          created: args.create ? { d0: { ...docsNode() }, f0: { ...fileNode() } } : undefined,
          destroyed: args.destroy ?? [],
          updated: args.update ?? {},
        },
        id,
      ];
    }
    return [name, { accountId: ACCOUNT_ID }, id];
  });
  return { methodResponses: responses, sessionState: "1" };
}

function mockSignedInFetch() {
  wgwFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/jmap/session") return jsonResponse(jmapSessionBody());
    if (path === "/jmap") {
      const body = JSON.parse(String(init?.body)) as JmapRequest;
      return jsonResponse(handleJmap(body));
    }
    if (path === "/jmap/upload/bob") {
      return jsonResponse({ blobId: "jb-uploaded", type: "text/plain", size: 1 }, 201);
    }
    if (path.startsWith("/jmap/download/")) {
      return new Response("hello", { status: 200 });
    }
    if (path === "/files/context") {
      return jsonResponse({
        data: { username: ACCOUNT_ID, name: "Bob", role: "user", roots: ["/users", "/groups"] },
      });
    }
    if (path.startsWith("/files/children") || path.startsWith("/files/directories")) {
      throw new Error(`signed-in ops must not call ${path}`);
    }
    if (path.startsWith("/files/content") || path === "/files" || path.startsWith("/files?")) {
      if (path.startsWith("/files?") && path.includes("search=")) {
        return jsonResponse({ data: { files: [] } });
      }
      if (path.startsWith("/files/content")) {
        throw new Error(`signed-in ops must not call ${path}`);
      }
    }
    if (path.startsWith("/files?") && (init?.method === "PATCH" || init?.method === "DELETE")) {
      throw new Error(`signed-in ops must not call ${init.method} ${path}`);
    }
    return jsonResponse({});
  });
  wgwReadJson.mockImplementation(async (res: Response) => res.json());
}

describe("createWgwDriveOperations FileNode cutover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDriveJmapSessionForTests();
    wgwIsGuestSession.mockReturnValue(false);
    wgwGuestSharePath.mockReturnValue(null);
    mockSignedInFetch();
  });

  it("lists and creates folders via FileNode without REST tree I/O", async () => {
    const ops = createWgwDriveOperations("/users/bob");
    const listed = await ops.listDirectory("/users/bob");
    expect(listed.directory.files.some((entry) => entry.name === "Docs")).toBe(true);

    await ops.createFolder({ cwd: "/users/bob", name: "Docs" }, { refreshState: false });

    const paths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.includes("/files/children"))).toBe(false);
    expect(paths.some((path) => path.includes("/files/directories"))).toBe(false);
    expect(paths.some((path) => path === "/jmap")).toBe(true);
    expect(paths.some((path) => path === "/files/context")).toBe(true);
  });

  it("reads file bytes via fnb download and rejects uploads over maxSizeUpload", async () => {
    const ops = createWgwDriveOperations("/users/bob");
    const blob = await ops.readFileBlob("/users/bob/readme.md");
    expect(await blob.text()).toBe("hello");

    const huge = new File([new Uint8Array(25_000_001)], "huge.bin");
    await expect(ops.uploadFiles({ cwd: "/users/bob", files: [huge] })).rejects.toThrow(
      /maxSizeUpload/,
    );

    const paths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.startsWith("/jmap/download/"))).toBe(true);
    expect(paths.some((path) => path.includes("/files/content"))).toBe(false);
  });

  function guestFileEntry(dir: string, name: string) {
    return {
      type: "file" as const,
      path: `${dir}/${name}`,
      name,
      size: 1,
      time: 0,
      permissions: 0,
      myRights: {
        mayView: true,
        mayComment: false,
        mayReview: false,
        mayEditContent: false,
        mayManageStructure: false,
        mayShare: false,
      },
    };
  }

  it("keeps guest tree I/O on REST children and content", async () => {
    wgwIsGuestSession.mockReturnValue(true);
    wgwGuestSharePath.mockReturnValue("/users/bob/Test");
    wgwFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/files/children")) {
        return jsonResponse({
          data: {
            location: "/users/bob/Test",
            files: [guestFileEntry("/users/bob/Test", "readme.md")],
          },
        });
      }
      if (path.startsWith("/files/content")) return new Response("guest", { status: 200 });
      if (path === "/files/context" || path === "/files/starred") {
        return new Response("forbidden", { status: 403 });
      }
      return jsonResponse({});
    });

    const ops = createWgwDriveOperations("/users/bob/Test");
    const listed = await ops.listDirectory("/users/bob/Test");
    expect(listed.directory.files[0]?.name).toBe("readme.md");
    expect(listed.user.role).toBe("guest");
    const blob = await ops.readFileBlob("/users/bob/Test/readme.md");
    expect(await blob.text()).toBe("guest");
    await expect(ops.listStars()).resolves.toEqual([]);

    const paths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.includes("/files/children"))).toBe(true);
    expect(paths.some((path) => path.includes("/files/content"))).toBe(true);
    expect(paths.some((path) => path === "/jmap")).toBe(false);
    expect(paths.some((path) => path === "/files/context")).toBe(false);
    expect(paths.some((path) => path === "/files/starred")).toBe(false);
  });

  it("bootstraps a folder share by listing the shared directory", async () => {
    wgwIsGuestSession.mockReturnValue(true);
    wgwGuestSharePath.mockReturnValue("/users/bob/Test");
    wgwFetchPrincipal.mockResolvedValue({
      user: { username: "share:abc", displayName: "Guest", initials: "G" },
    });
    wgwFetch.mockImplementation(async (path: string) => {
      if (path === "/files/children?path=%2Fusers%2Fbob%2FTest") {
        return jsonResponse({
          data: {
            location: "/users/bob/Test",
            files: [guestFileEntry("/users/bob/Test", "inside.md")],
          },
        });
      }
      if (
        path.startsWith("/files/children?path=%2Fusers%2Fbob&") ||
        path === "/files/children?path=%2Fusers%2Fbob"
      ) {
        return new Response("denied", { status: 400 });
      }
      if (path === "/files/context" || path === "/files/starred") {
        return new Response("forbidden", { status: 403 });
      }
      return jsonResponse({});
    });

    const bootstrap = await fetchDriveLiveBootstrap();
    expect(bootstrap.data.directory.files.map((entry) => entry.name)).toEqual(["inside.md"]);
    expect(bootstrap.data.user.username).toBe("bob");

    const childPaths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(childPaths.some((path) => path.includes("path=%2Fusers%2Fbob%2FTest"))).toBe(true);
    expect(childPaths.some((path) => path === "/files/children?path=%2Fusers%2Fbob")).toBe(false);
  });
});
