/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import {
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  FILENODE_SHARE_FLAGS_CAPABILITY,
  FILENODE_TREE_CAPABILITY,
  JmapClient,
  JmapFileNodesClient,
  type JmapInvocation,
  type JmapRequest,
  type JmapSession,
} from "@/lib/jmap-client";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import "@/lib/offline/docs/docs-schema";
import { writeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { findUploadPlaceholder } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import { enqueueDriveUploadBatch } from "@/lib/offline/drive/upload/drive-upload-store";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { docsCollabIndexedDbKey, docsCollabRoomKey } from "@/lib/collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/lib/collab/pending-server-save-key";
import {
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  DRIVE_DOMAIN,
  driveContentBlobsTable,
  driveEntriesTable,
  driveTreePrepassTable,
  driveTreeStagingTable,
} from "@/lib/offline/drive/drive-schema";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";

const pacer = vi.hoisted(() => ({
  acquire: vi.fn(async () => undefined),
  reportRateLimited: vi.fn(),
  reportSuccess: vi.fn(),
  noteUserActivity: vi.fn(),
}));
const current = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("@/lib/offline/core/browser-online", () => ({ getConnectivitySnapshot: () => true }));
vi.mock("@/lib/offline/core/background-sync-pacer", async () => ({
  ...(await vi.importActual<object>("@/lib/offline/core/background-sync-pacer")),
  backgroundSyncPacer: () => pacer,
}));
vi.mock("@/lib/api/wgw/drive-jmap", async () => ({
  ...(await vi.importActual<object>("@/lib/api/wgw/drive-jmap")),
  driveJmapSession: async () => current.session,
}));

import {
  readDriveSyncToken,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-file-node-changes";
import { syncDriveInboundFromFileNodes } from "@/lib/offline/drive/drive-inbound-sync";
import {
  DRIVE_TREE_FIRST_SYNC_DONE_KEY,
  DRIVE_TREE_LAST_PASS_KEY,
  readDriveTreeFirstSyncDone,
  syncDriveTree,
} from "@/lib/offline/drive/drive-tree-sync";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { migrateDriveEntryPath } from "@/lib/offline/drive/drive-directory-offline-store";
import { readDocsPageSetupOverrides, writeDocsPageSetupOverride } from "@/lib/docs-page-setup";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";

const username = "ada";
/** Page size of the stand-in (`maxObjectsInGet`); small so a few nodes span many pages. */
const LIMIT = 2;

type ServerNode = {
  id: string;
  parentId: string | null;
  name: string;
  dir: boolean;
  createdSeq: number;
  changedSeq: number;
  deletedSeq?: number;
  arrivedSeq?: number;
  /** Root path of a parentless node. */
  rootPath?: string;
  /** A parentless node the person cannot see (someone else's home). */
  hidden?: boolean;
  /** A node shared with the person: visible although its parent is not. */
  sharedWithMe?: boolean;
  shareFlags?: { hasShares: boolean; hasPublicShare: boolean; hasTeamShare: boolean };
};

/**
 * The server contract C1 codes against (#2063 S1–S3): an unfiltered keyset
 * walk in `node_id` order limited by `asOfState`, `#idAfter` / `#asOfState`
 * back-references, `path` on get, `FileNode/changes` with arrivals, share flags.
 */
class TreeServer {
  seq = 1;
  readonly nodes = new Map<string, ServerNode>();
  readonly requests: JmapRequest[] = [];
  /** Runs after the n-th request (1-based) is answered. */
  readonly after = new Map<number, () => void | Promise<void>>();
  /** Fail the `nth` (0-based) `FileNode/get` of listing request `request` (1-based). */
  failGet: { request: number; nth: number } | null = null;
  cannotCalculate = 0;
  /** A server that caps the query `limit` below the client's and says so in the answer. */
  capLimit: number | null = null;

  state(): string {
    return `${this.seq}.h`;
  }

  root(id: string, rootPath: string, hidden = false): void {
    this.nodes.set(id, {
      id,
      parentId: null,
      name: rootPath.split("/").pop()!,
      dir: true,
      createdSeq: 0,
      changedSeq: 0,
      rootPath,
      hidden,
    });
  }

  add(id: string, parentId: string, name: string, extra: Partial<ServerNode> = {}): void {
    this.seq += 1;
    const dir = !name.includes(".") || name.startsWith(".");
    this.nodes.set(id, {
      id,
      parentId,
      name,
      dir,
      createdSeq: this.seq,
      changedSeq: this.seq,
      ...extra,
    });
  }

  /** Rename or move one node; like `recordMove`, only that node is bumped (plus arrivals). */
  move(id: string, changes: { name?: string; parentId?: string }): void {
    const node = this.nodes.get(id)!;
    const before = new Set(
      this.subtree(id)
        .filter((n) => this.visible(n))
        .map((n) => n.id),
    );
    this.seq += 1;
    Object.assign(node, changes, { changedSeq: this.seq });
    for (const n of this.subtree(id)) {
      if (!before.has(n.id) && this.visible(n)) n.arrivedSeq = this.seq;
    }
  }

  remove(id: string): void {
    this.seq += 1;
    this.nodes.get(id)!.deletedSeq = this.seq;
  }

  subtree(id: string): ServerNode[] {
    const out = [this.nodes.get(id)!];
    for (const n of this.nodes.values()) {
      if (n.parentId === id) out.push(...this.subtree(n.id));
    }
    return out;
  }

  visible(node: ServerNode): boolean {
    if (node.sharedWithMe) return true;
    if (!node.parentId) return !node.hidden;
    return this.visible(this.nodes.get(node.parentId)!);
  }

  live(node: ServerNode): boolean {
    return node.deletedSeq === undefined && this.visible(node);
  }

  path(node: ServerNode): string {
    if (!node.parentId) return node.rootPath!;
    return `${this.path(this.nodes.get(node.parentId)!)}/${node.name}`;
  }

  listingRequests(): JmapRequest[] {
    return this.requests.filter((r) => r.methodCalls.some(([name]) => name === "FileNode/query"));
  }

  handle(request: JmapRequest): JmapInvocation[] {
    this.requests.push(request);
    const listingIndex = this.listingRequests().length;
    const isListing = request.methodCalls.some(([name]) => name === "FileNode/query");
    const answers: JmapInvocation[] = [];
    let getCount = 0;
    for (const [name, rawArgs, id] of request.methodCalls) {
      const args = this.resolve(rawArgs, answers);
      if (!args) {
        answers.push(["error", { type: "invalidResultReference" }, id]);
        continue;
      }
      if (name === "FileNode/get" && Array.isArray(args.ids) && args.ids.length > 0) {
        const nth = getCount++;
        const fail = this.failGet;
        if (isListing && fail && fail.request === listingIndex && fail.nth === nth) {
          answers.push(["error", { type: "serverFail" }, id]);
          continue;
        }
      }
      answers.push(this.method(name, args, id));
    }
    return answers;
  }

  resolve(
    args: Record<string, unknown>,
    answers: readonly JmapInvocation[],
  ): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!key.startsWith("#")) {
        out[key] = value;
        continue;
      }
      const ref = value as { resultOf: string; name: string; path: string };
      const answer = answers.find(([, , callId]) => callId === ref.resultOf);
      if (!answer || answer[0] !== ref.name) return null;
      const [, field, index] = ref.path.split("/");
      const base = answer[1][field!];
      const resolved = index === undefined ? base : (base as unknown[])[Number(index)];
      if (resolved === undefined) return null;
      out[key.slice(1)] = resolved;
    }
    return out;
  }

  method(name: string, args: Record<string, unknown>, id: string): JmapInvocation {
    if (name === "FileNode/get") {
      const ids = (args.ids as string[]) ?? [];
      const found = ids.flatMap((nodeId) => {
        const node = this.nodes.get(nodeId);
        return node && this.live(node) ? [node] : [];
      });
      const list = found.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        nodeType: node.dir ? "directory" : "file",
        blobId: null,
        size: 1,
        type: null,
        path: this.path(node),
        ...(node.shareFlags ? { shareFlags: node.shareFlags } : {}),
      }));
      const notFound = ids.filter((nodeId) => !found.some((node) => node.id === nodeId));
      return [name, { accountId: "ada", state: this.state(), list, notFound }, id];
    }
    if (name === "FileNode/query") {
      const asOf = Number(String(args.asOfState).split(".")[0]);
      const after = typeof args.idAfter === "string" ? args.idAfter : "";
      const ids = [...this.nodes.values()]
        .filter((n) => this.live(n) && n.createdSeq <= asOf && n.id > after)
        .map((n) => n.id)
        .sort()
        .slice(0, this.capLimit ?? Number(args.limit));
      const capped = this.capLimit === null ? {} : { limit: this.capLimit };
      return [
        name,
        { accountId: "ada", queryState: this.state(), ids, position: 0, ...capped },
        id,
      ];
    }
    if (name === "FileNode/changes") {
      if (this.cannotCalculate > 0) {
        this.cannotCalculate -= 1;
        return ["error", { type: "cannotCalculateChanges" }, id];
      }
      const since = Number(String(args.sinceState).split(".")[0]);
      const created: string[] = [];
      const updated: string[] = [];
      const destroyed: string[] = [];
      for (const n of this.nodes.values()) {
        if (n.deletedSeq !== undefined) {
          if (n.deletedSeq > since && n.createdSeq <= since) destroyed.push(n.id);
        } else if (this.live(n) && n.createdSeq > since) created.push(n.id);
        else if (this.live(n) && Math.max(n.changedSeq, n.arrivedSeq ?? 0) > since) {
          updated.push(n.id);
        }
      }
      const body = { accountId: "ada", oldState: args.sinceState, newState: this.state() };
      return [name, { ...body, hasMoreChanges: false, created, updated, destroyed }, id];
    }
    return ["error", { type: "unknownMethod" }, id];
  }
}

async function connect(server: TreeServer, options?: { keyset?: boolean }): Promise<void> {
  const keyset = options?.keyset ?? true;
  const capabilities: Record<string, unknown> = {
    [CORE_CAPABILITY]: { maxObjectsInGet: LIMIT, maxCallsInRequest: 32 },
    [FILENODE_CAPABILITY]: {},
    [FILENODE_SHARE_FLAGS_CAPABILITY]: {},
    ...(keyset ? { [FILENODE_TREE_CAPABILITY]: {} } : {}),
  };
  const jmapSession = {
    capabilities,
    accounts: {},
    primaryAccounts: { [FILENODE_CAPABILITY]: "ada" },
    username,
    apiUrl: "/jmap",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    state: "1",
  } satisfies JmapSession;
  const client = new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: async (input, init) => {
      if (input === "/jmap/session") return new Response(JSON.stringify(jmapSession));
      const request = JSON.parse(String(init?.body)) as JmapRequest;
      const methodResponses = server.handle(request);
      const answered = server.requests.length;
      await server.after.get(answered)?.();
      return new Response(JSON.stringify({ methodResponses, sessionState: "1" }));
    },
  });
  await client.connect();
  current.session = {
    client,
    fileNodes: new JmapFileNodesClient(client),
    accountId: "ada",
    treeKeyset: keyset,
    shareFlags: true,
    maxCallsInRequest: 32,
    maxObjectsInGet: LIMIT,
  } as Partial<DriveJmapSession>;
}

/** Ada's home and team drive; ids sort in the walk's `node_id` order. */
function standardTree(): TreeServer {
  const server = new TreeServer();
  server.root("r-home", "/users/ada");
  server.root("r-team", "/groups/team");
  return server;
}

const db = () => offlineDbForAccount(offlineAccountKeyFromUsername(username));

async function row(path: string) {
  return driveEntriesTable(db()).get(path.replace(/^\//, ""));
}

async function rowPaths(): Promise<string[]> {
  return (await driveEntriesTable(db()).toCollection().primaryKeys()).sort();
}

function staleEntry(path: string, nodeId: string): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path,
    nodeId,
    name: path.split("/").pop()!,
    size: 1,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

async function seedPendingSave(apiPath: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(
    docsCollabIndexedDbKey(docsCollabRoomKey(apiPath)),
    ydoc,
  );
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

beforeEach(async () => {
  pacer.acquire.mockClear();
  await driveEntriesTable(db()).clear();
  await driveTreeStagingTable(db()).clear();
  await driveTreePrepassTable(db()).clear();
  await driveContentBlobsTable(db()).clear();
  await db().table("drive_upload_items").clear();
  await db().table("drive_upload_batches").clear();
  await db().outbox.clear();
  await db().meta.clear();
});

describe("syncDriveTree", () => {
  it("opens with a token: changes only, no query", async () => {
    const server = standardTree();
    server.add("a1", "r-home", "notes.md");
    await connect(server);
    await writeDriveSyncToken(username, server.state());
    await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "tree");
    await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
    server.add("a2", "r-home", "new.md");

    await syncDriveInboundFromFileNodes(username);

    const methods = server.requests.flatMap((r) => r.methodCalls.map(([name]) => name));
    expect(methods).not.toContain("FileNode/query");
    expect(methods[0]).toBe("FileNode/changes");
    expect(await row("/users/ada/new.md")).toBeDefined();
  });

  it("first sync batches the state get plus 15 pages, then 16 pages per request", async () => {
    const server = standardTree();
    // 15 + 16 full pages of 2, then one short page: 63 nodes with the two roots.
    for (let i = 0; i < 61; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    server.add("t-trash", "r-home", ".Trash");
    server.add("t-gone", "t-trash", "gone.md");
    await connect(server);
    const startState = server.state();

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.usedFullResync).toBe(true);
    const listing = server.listingRequests();
    expect(listing).toHaveLength(3);
    const [first, second] = listing;
    expect(first!.methodCalls).toHaveLength(31);
    expect(first!.methodCalls[0]).toEqual([
      "FileNode/get",
      { accountId: "ada", ids: [] },
      expect.any(String),
    ]);
    expect(second!.methodCalls).toHaveLength(32);
    expect(first!.using).toContain(FILENODE_TREE_CAPABILITY);
    const secondQuery = first!.methodCalls[3]![1];
    expect(secondQuery["#idAfter"]).toMatchObject({
      name: "FileNode/query",
      path: `/ids/${LIMIT - 1}`,
    });
    expect(secondQuery["#asOfState"]).toMatchObject({ name: "FileNode/get", path: "/state" });
    expect(second!.methodCalls[0]![1]).toMatchObject({ asOfState: startState, idAfter: "n029" });
    // 500 ids per page: 15 + 16 + 16 pages reach 23,500 nodes in three requests.
    expect((15 + 16 + 16) * 500).toBeGreaterThanOrEqual(20_000);
    expect(pacer.acquire).toHaveBeenCalledWith(undefined, "first");
    expect(await row("/users/ada/f60.md")).toMatchObject({ area: "home", ext: "md" });
    expect(await row("/users/ada/.Trash/gone.md")).toMatchObject({ area: "trash" });
    expect(await readDriveSyncToken(username)).toBe(server.state());
    expect(await readDriveTreeFirstSyncDone(username)).toBe(true);
    expect(await driveTreeStagingTable(db()).count()).toBe(0);
  });

  it("resumes from the cursor", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    const controller = new AbortController();
    server.after.set(1, () => controller.abort());

    const aborted = await syncDriveTree(username, { signal: controller.signal });
    expect(aborted.completed).toBe(false);
    expect(await readDriveSyncToken(username)).toBeNull();

    await syncDriveTree(username);

    const [, resumed] = server.listingRequests();
    expect(resumed!.methodCalls[0]![0]).toBe("FileNode/query");
    // 15 pages of 2 ids came back before the abort: n000 … n029.
    expect(resumed!.methodCalls[0]![1]).toMatchObject({ asOfState: "41.h", idAfter: "n029" });
    const queried = server
      .listingRequests()
      .flatMap((r) => r.methodCalls.filter(([name]) => name === "FileNode/query"));
    expect(queried.filter(([, args]) => args.idAfter === "n029")).toHaveLength(1);
    expect(await readDriveSyncToken(username)).toBe(server.state());
  });

  it("a resume that finishes keeps the rows fetched before the abort", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    const controller = new AbortController();
    server.after.set(1, () => controller.abort());
    await syncDriveTree(username, { signal: controller.signal });
    expect(await driveTreeStagingTable(db()).count()).toBe(30);

    await syncDriveTree(username);

    expect(await row("/users/ada/f0.md")).toBeDefined();
    expect(await row("/users/ada/f39.md")).toBeDefined();
    expect((await rowPaths()).length).toBe(40);
  });

  it("a node deleted mid-pass does not prune an unchanged node", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    server.after.set(1, () => server.remove("n003"));

    await syncDriveTree(username);

    expect(await row("/users/ada/f3.md")).toBeUndefined();
    expect(await row("/users/ada/f28.md")).toBeDefined();
    expect(await row("/users/ada/f39.md")).toBeDefined();
    expect((await rowPaths()).length).toBe(39);
  });

  it("a node renamed onto an earlier page is caught up", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    server.after.set(1, () => server.move("n035", { name: "a-first.md" }));

    await syncDriveTree(username);

    expect(await row("/users/ada/f35.md")).toBeUndefined();
    expect(await row("/users/ada/a-first.md")).toMatchObject({ nodeId: "n035" });
  });

  it("a folder renamed during the walk takes its already-fetched children with it", async () => {
    const server = standardTree();
    server.add("d-plans", "r-home", "Plans");
    server.add("d-plans-c", "d-plans", "child.md");
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    server.after.set(1, () => server.move("d-plans", { name: "Archive" }));

    await syncDriveTree(username);

    expect(await row("/users/ada/Archive/child.md")).toMatchObject({ nodeId: "d-plans-c" });
    expect(await row("/users/ada/Plans/child.md")).toBeUndefined();
    expect(await row("/users/ada/Plans")).toBeUndefined();
  });

  it("an inner folder also renamed during the walk keeps its child at the inner path", async () => {
    const server = standardTree();
    server.add("d-out", "r-home", "Outer");
    server.add("d-out-in", "d-out", "Inner");
    server.add("d-out-in-c", "d-out-in", "c.md");
    await connect(server);
    server.after.set(1, () => {
      server.move("d-out", { name: "Outer2" });
      server.move("d-out-in", { name: "Inner2" });
    });

    await syncDriveTree(username);

    expect(await rowPaths()).toEqual([
      "users/ada/Outer2",
      "users/ada/Outer2/Inner2",
      "users/ada/Outer2/Inner2/c.md",
    ]);
  });

  it("a renamed folder takes a grandchild under an unchanged subfolder", async () => {
    const server = standardTree();
    server.add("d-a", "r-home", "A");
    server.add("d-a-b", "d-a", "B");
    server.add("d-a-b-g", "d-a-b", "g.md");
    await connect(server);
    server.after.set(1, () => server.move("d-a", { name: "Z" }));

    await syncDriveTree(username);

    expect(await row("/users/ada/Z/B/g.md")).toMatchObject({ nodeId: "d-a-b-g" });
    expect(await row("/users/ada/A/B/g.md")).toBeUndefined();
  });

  it("a folder moved out of .notes takes its already-fetched child with it", async () => {
    const server = standardTree();
    server.add("d-notes", "r-home", ".notes");
    server.add("d-notes-f", "d-notes", "Folder");
    server.add("d-notes-f-c", "d-notes-f", "c.md");
    await connect(server);
    server.after.set(1, () => server.move("d-notes-f", { parentId: "r-home" }));

    await syncDriveTree(username);

    expect(await row("/users/ada/Folder/c.md")).toMatchObject({ nodeId: "d-notes-f-c" });
    expect((await rowPaths()).some((path) => path.includes(".notes"))).toBe(false);
  });

  it("a node created mid-pass is kept by the prune", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    server.after.set(1, () => server.add("a-new", "r-home", "fresh.md"));

    await syncDriveTree(username);

    expect(await row("/users/ada/fresh.md")).toMatchObject({ nodeId: "a-new" });
  });

  it("a node created and deleted during the walk is not stored", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    server.after.set(1, () => {
      server.add("z-ghost", "r-home", "ghost.md");
      server.remove("z-ghost");
    });

    await syncDriveTree(username);

    expect(await row("/users/ada/ghost.md")).toBeUndefined();
  });

  it("cannotCalculateChanges after the walk does not prune or store the token", async () => {
    const server = standardTree();
    server.add("a1", "r-home", "kept.md");
    await upsertDriveEntry(username, staleEntry("/users/ada/stale.md", "x-stale"));
    server.cannotCalculate = 99;
    await connect(server);

    const result = await syncDriveTree(username);

    expect(result.completed).toBe(false);
    expect(await row("/users/ada/stale.md")).toBeDefined();
    expect(await readDriveSyncToken(username)).toBeNull();
    // Every pass took a new starting state.
    const stateGets = server.requests.filter((r) => {
      const [name, args] = r.methodCalls[0]!;
      return name === "FileNode/get" && Array.isArray(args.ids) && args.ids.length === 0;
    });
    expect(stateGets).toHaveLength(3);
  });

  it("a failed get mid-chain does not prune", async () => {
    const server = standardTree();
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await upsertDriveEntry(username, staleEntry("/users/ada/stale.md", "x-stale"));
    server.failGet = { request: 1, nth: 2 };
    await connect(server);

    const failed = await syncDriveTree(username);

    expect(failed.completed).toBe(false);
    expect(await row("/users/ada/stale.md")).toBeDefined();
    expect(await readDriveSyncToken(username)).toBeNull();
    expect(await driveTreeStagingTable(db()).count()).toBe(2 * LIMIT);

    server.failGet = null;
    await syncDriveTree(username);

    const retry = server.listingRequests()[1]!;
    expect(retry.methodCalls[0]![1]).toMatchObject({ idAfter: "n003" });
    for (let i = 2; i < 40; i += 1) expect(await row(`/users/ada/f${i}.md`)).toBeDefined();
    expect(await row("/users/ada/stale.md")).toBeUndefined();
  });

  it("a child that arrives before its parent gets the right path", async () => {
    const server = standardTree();
    server.add("z-dir", "r-home", "Before");
    server.add("a-child", "z-dir", "c.md");
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    // The child was fetched on page 1 under the old name; the parent comes later.
    server.after.set(1, () => server.move("z-dir", { name: "After" }));

    await syncDriveTree(username);

    expect(await row("/users/ada/After/c.md")).toMatchObject({ nodeId: "a-child" });
    expect(await row("/users/ada/Before/c.md")).toBeUndefined();
  });

  it("child before parent is not a share root", async () => {
    const server = standardTree();
    server.add("z-team-dir", "r-team", "Shared plans");
    server.add("a-team-child", "z-team-dir", "c.md");
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);

    await syncDriveTree(username);

    expect(await row("/groups/team/Shared plans/c.md")).toMatchObject({ area: "group" });
  });

  it("two share roots with the same name keep separate paths", async () => {
    const server = standardTree();
    server.root("r-bob", "/users/bob", true);
    server.root("r-cy", "/users/cy", true);
    server.add("s-bob", "r-bob", "Plans", { sharedWithMe: true });
    server.add("s-bob-c", "s-bob", "b.md");
    server.add("s-cy", "r-cy", "Plans", { sharedWithMe: true });
    server.add("s-cy-c", "s-cy", "c.md");
    await connect(server);

    await syncDriveTree(username);

    expect(await row("/users/bob/Plans")).toMatchObject({ area: "share", nodeId: "s-bob" });
    expect(await row("/users/cy/Plans")).toMatchObject({ area: "share", nodeId: "s-cy" });
    expect(await row("/users/bob/Plans/b.md")).toMatchObject({ area: "share" });
    expect(await row("/users/cy/Plans/c.md")).toMatchObject({ area: "share" });
  });

  it("share flags from get are stored on the entry", async () => {
    const server = standardTree();
    const flags = { hasShares: true, hasPublicShare: true, hasTeamShare: false };
    server.add("a1", "r-home", "public.md", { shareFlags: flags });
    await connect(server);

    await syncDriveTree(username);

    expect(await readDriveEntryFromCache(username, "/users/ada/public.md")).toMatchObject(flags);
    const gets = server.listingRequests()[0]!.using;
    expect(gets).toContain(FILENODE_SHARE_FLAGS_CAPABILITY);
  });

  it("prune keeps protected rows", async () => {
    const server = standardTree();
    server.add("a1", "r-home", "kept.md");
    await upsertDriveEntry(username, staleEntry("/users/ada/Offline/queued.md", "x-q"));
    await upsertDriveEntry(username, { ...staleEntry("/users/ada/Offline", "x-dir"), type: "dir" });
    await upsertDriveEntry(username, staleEntry("/users/ada/renamed.md", "x-r"));
    await enqueueOutboxMutation(username, {
      id: "create-1",
      domain: DRIVE_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/ada/Offline/queued.md",
        destination: "/users/ada",
        to: "renamed.md",
      }),
    });
    await upsertDriveEntry(username, staleEntry("/users/ada/gone.md", "x-gone"));
    await upsertDriveEntry(username, {
      ...staleEntry("/users/ada/Drafts", "x-drafts"),
      type: "dir",
    });
    await upsertDriveEntry(username, staleEntry("/users/ada/Drafts/unsaved.md", "x-unsaved"));
    await seedPendingSave("/users/ada/Drafts/unsaved.md");
    const { itemIds } = await enqueueDriveUploadBatch(username, {
      folderPath: "/users/ada/kept-folder",
      targetFolder: { kind: "server", id: "fn-dir" },
      files: [new File(["x"], "upload.pdf", { type: "application/pdf" })],
    });
    await connect(server);

    const result = await syncDriveTree(username);

    expect(await row("/users/ada/renamed.md")).toBeDefined();
    expect(await row("/users/ada/Offline/queued.md")).toBeDefined();
    expect(await row("/users/ada/Offline")).toBeDefined();
    expect(await row("/users/ada/gone.md")).toBeUndefined();
    expect(await row("/users/ada/kept.md")).toBeDefined();
    expect(await findUploadPlaceholder(username, itemIds[0]!)).toBeDefined();
    expect(await row("/users/ada/Drafts/unsaved.md")).toBeDefined();
    expect(await row("/users/ada/Drafts")).toBeDefined();
    expect(result.keptUnsavedPaths).toEqual(["users/ada/Drafts/unsaved.md"]);
  });

  it("a node already cached at another path takes its blob to the final path", async () => {
    const server = standardTree();
    server.add("d-old", "r-home", "Old");
    server.add("d-old-c", "d-old", "c.md");
    await upsertDriveEntry(username, { ...staleEntry("/users/ada/Old", "d-old"), type: "dir" });
    await upsertDriveEntry(username, staleEntry("/users/ada/Old/c.md", "d-old-c"));
    await writeDriveContentBlob(username, "/users/ada/Old/c.md", new Blob(["body"]));
    server.move("d-old", { name: "New" });
    await connect(server);

    await syncDriveTree(username);

    expect(await driveContentBlobsTable(db()).get("users/ada/New/c.md")).toBeDefined();
    expect(await driveContentBlobsTable(db()).get("users/ada/Old/c.md")).toBeUndefined();
    expect(await rowPaths()).toEqual(["users/ada/New", "users/ada/New/c.md"]);
  });

  it("keeps the per-folder crawl on a server without the keyset", async () => {
    const server = standardTree();
    await connect(server, { keyset: false });
    const crawl = await import("@/lib/offline/drive/drive-metadata-sync");
    const spy = vi.spyOn(crawl, "syncDriveMetadataTree").mockResolvedValue({
      running: false,
      total: 1,
      synced: 1,
      failed: 0,
      updatedAt: 1,
    });

    const result = await syncDriveTree(username);

    expect(result.completed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(server.listingRequests()).toHaveLength(0);
    expect(await readDriveSyncToken(username)).toBe(server.state());
    spy.mockRestore();
  });
});

describe("FileNode/changes applier and the tree", () => {
  it("a row moved under .notes is removed", async () => {
    const server = standardTree();
    server.add("d-notes", "r-home", ".notes");
    server.add("a-doc", "r-home", "doc.md");
    await connect(server);
    await syncDriveTree(username);
    expect(await row("/users/ada/doc.md")).toBeDefined();

    server.move("a-doc", { parentId: "d-notes" });
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/doc.md")).toBeUndefined();
    expect((await rowPaths()).some((path) => path.includes(".notes"))).toBe(false);
  });

  describe("a folder moved into a team drive brings its children", () => {
    it("through the applier", async () => {
      const server = standardTree();
      server.root("r-bob", "/users/bob", true);
      server.add("b-dir", "r-bob", "Report");
      server.add("b-dir-c", "b-dir", "data.csv");
      await connect(server);
      await syncDriveTree(username);
      expect(await row("/groups/team/Report")).toBeUndefined();

      server.move("b-dir", { parentId: "r-team" });
      await syncDriveInboundFromFileNodes(username);

      expect(await row("/groups/team/Report")).toMatchObject({ area: "group" });
      expect(await row("/groups/team/Report/data.csv")).toMatchObject({
        area: "group",
        ext: "csv",
      });
    });

    it("through the walk catch-up", async () => {
      const server = standardTree();
      server.root("r-bob", "/users/bob", true);
      server.add("b-dir", "r-bob", "Report");
      server.add("b-dir-c", "b-dir", "data.csv");
      for (let i = 0; i < 40; i += 1)
        server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
      await connect(server);
      server.after.set(1, () => server.move("b-dir", { parentId: "r-team" }));

      await syncDriveTree(username);

      expect(await row("/groups/team/Report/data.csv")).toMatchObject({ nodeId: "b-dir-c" });
    });
  });
});

describe("review fixes (#2063 C1)", () => {
  async function mockCrawl(during?: () => void) {
    const crawl = await import("@/lib/offline/drive/drive-metadata-sync");
    return vi.spyOn(crawl, "syncDriveMetadataTree").mockImplementation(async () => {
      during?.();
      return { running: false, total: 1, synced: 1, failed: 0, updatedAt: 1 };
    });
  }

  it("a file written while the per-folder crawl runs arrives on the next sync", async () => {
    const server = standardTree();
    await connect(server, { keyset: false });
    const spy = await mockCrawl(() => server.add("a-during", "r-home", "during.md"));

    await syncDriveInboundFromFileNodes(username);
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/during.md")).toMatchObject({ nodeId: "a-during" });
    spy.mockRestore();
  });

  it("after the crawl a new file directly under home is home, not share", async () => {
    const server = standardTree();
    await connect(server, { keyset: false });
    const spy = await mockCrawl();
    await syncDriveInboundFromFileNodes(username);

    server.add("a-home", "r-home", "home.md");
    server.add("a-team", "r-team", "team.md");
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/home.md")).toMatchObject({ area: "home" });
    expect(await row("/groups/team/team.md")).toMatchObject({ area: "group" });
    spy.mockRestore();
  });

  it("a token without a completed first sync runs the full sync once", async () => {
    const server = standardTree();
    server.add("a1", "r-home", "a.md");
    await connect(server, { keyset: false });
    // A device that synced before the tree walk: a token, no first-sync flag.
    await writeDriveSyncToken(username, server.state());
    const spy = await mockCrawl();

    await syncDriveInboundFromFileNodes(username);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await readDriveTreeFirstSyncDone(username)).toBe(true);

    await syncDriveInboundFromFileNodes(username);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("a device that only crawled walks the tree once the server offers the keyset", async () => {
    const server = standardTree();
    server.add("a1", "r-home", "a.md");
    await connect(server, { keyset: false });
    const spy = await mockCrawl();
    await syncDriveInboundFromFileNodes(username);
    spy.mockRestore();
    expect(await readMeta(username, DRIVE_TREE_LAST_PASS_KEY)).toBe("crawl");

    await connect(server);
    await syncDriveInboundFromFileNodes(username);
    expect(server.listingRequests()).toHaveLength(1);
    expect(await readMeta(username, DRIVE_TREE_LAST_PASS_KEY)).toBe("tree");
    expect(await row("/users/ada/a.md")).toMatchObject({ area: "home" });

    await syncDriveInboundFromFileNodes(username);
    expect(server.listingRequests()).toHaveLength(1);
  });

  it("a folder moved into .Trash gives its unlisted child the trash area", async () => {
    const server = standardTree();
    server.add("t-trash", "r-home", ".Trash");
    server.add("d-proj", "r-home", "Proj");
    server.add("d-proj-a", "d-proj", "a.md");
    await connect(server);
    await syncDriveTree(username);
    expect(await row("/users/ada/Proj/a.md")).toMatchObject({ area: "home" });

    server.move("d-proj", { parentId: "t-trash" });
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/.Trash/Proj")).toMatchObject({ area: "trash" });
    expect(await row("/users/ada/.Trash/Proj/a.md")).toMatchObject({ area: "trash" });
  });

  it("a home folder moved into a team drive gives its unlisted child the group area", async () => {
    const server = standardTree();
    server.add("d-proj", "r-home", "Proj");
    server.add("d-proj-a", "d-proj", "a.md");
    await connect(server);
    await syncDriveTree(username);

    server.move("d-proj", { parentId: "r-team" });
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/groups/team/Proj/a.md")).toMatchObject({ area: "group" });
    expect(await row("/users/ada/Proj/a.md")).toBeUndefined();
  });

  it("a local move out of .Trash gives the folder and its descendants home back", async () => {
    await upsertDriveEntry(
      username,
      { ...staleEntry("/users/ada/.Trash/Proj", "d-proj"), type: "dir" },
      "trash",
    );
    await upsertDriveEntry(username, staleEntry("/users/ada/.Trash/Proj/a.md", "d-a"), "trash");

    await migrateDriveEntryPath(username, "/users/ada/.Trash/Proj", "/users/ada/Proj");

    expect(await row("/users/ada/Proj")).toMatchObject({ area: "home" });
    expect(await row("/users/ada/Proj/a.md")).toMatchObject({ area: "home" });
  });

  it("two files that swap names in one changes batch keep their own blobs", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));

    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });
    await syncDriveInboundFromFileNodes(username);

    // Sizes tell the bodies apart: "A" is 1 byte, "BB" 2.
    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });

  it("two files that swap names before a tree pass keep their own blobs", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await upsertDriveEntry(username, staleEntry("/users/ada/a.md", "f-a"));
    await upsertDriveEntry(username, staleEntry("/users/ada/b.md", "f-b"));
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });
    await connect(server);

    await syncDriveTree(username);

    // Sizes tell the bodies apart: "A" is 1 byte, "BB" 2.
    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });

  it("a nested rename in one changes batch keeps the page setup at the inner path", async () => {
    const server = standardTree();
    server.add("d-outer", "r-home", "Outer");
    server.add("d-inner", "d-outer", "Inner");
    server.add("f-doc", "d-inner", "doc.md");
    await connect(server);
    await syncDriveTree(username);
    writeDocsPageSetupOverride("/users/ada/Outer/Inner/doc.md", {
      format: "a4",
      orientation: "landscape",
    });

    server.move("d-outer", { name: "Outer2" });
    server.move("d-inner", { name: "Inner2" });
    await syncDriveInboundFromFileNodes(username);

    const overrides = readDocsPageSetupOverrides();
    expect(overrides["/users/ada/Outer2/Inner2/doc.md"]).toMatchObject({ format: "a4" });
    expect(overrides["/users/ada/Outer2/Inner/doc.md"]).toBeUndefined();
  });

  it("a server that caps the page size does not end the walk early", async () => {
    const server = standardTree();
    for (let i = 0; i < 5; i += 1) server.add(`n${i}`, "r-home", `f${i}.md`);
    server.capLimit = 1;
    await connect(server);

    let result = await syncDriveTree(username);
    for (let round = 0; !result.completed && round < 20; round += 1) {
      result = await syncDriveTree(username);
    }

    expect(result.completed).toBe(true);
    expect((await rowPaths()).filter((path) => path.endsWith(".md"))).toHaveLength(5);
  });
});

describe("moves that land on a path another node is leaving", () => {
  const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;

  it.each([
    ["b → c listed first", ["d-b", "d-a"]],
    ["a → b listed first", ["d-a", "d-b"]],
  ])("the chain b → c, a → b in one batch (%s)", async (_label, order) => {
    const server = standardTree();
    const names: Record<string, string> = { "d-a": "a", "d-b": "b" };
    for (const id of order) server.add(id, "r-home", names[id]!);
    server.add("f-a1", "d-a", "a1.md");
    server.add("f-b1", "d-b", "b1.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a/a1.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b/b1.md", new Blob(["BB"]));

    server.move("d-b", { name: "c" });
    server.move("d-a", { name: "b" });
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/b/a1.md")).toMatchObject({ nodeId: "f-a1" });
    expect(await row("/users/ada/c/b1.md")).toMatchObject({ nodeId: "f-b1" });
    expect(await row("/users/ada/c/a1.md")).toBeUndefined();
    expect(await row("/users/ada/b/b1.md")).toBeUndefined();
    expect(await blobSize("users/ada/b/a1.md")).toBe(1);
    expect(await blobSize("users/ada/c/b1.md")).toBe(2);
  });

  it("a folder swap keeps each unlisted readme with its node", async () => {
    const server = standardTree();
    server.add("d-fa", "r-home", "FA");
    server.add("d-fb", "r-home", "FB");
    server.add("f-ra", "d-fa", "readme.md");
    server.add("f-rb", "d-fb", "readme.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/FA/readme.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/FB/readme.md", new Blob(["BB"]));

    server.move("d-fa", { name: "FB" });
    server.move("d-fb", { name: "FA" });
    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/FA/readme.md")).toMatchObject({ nodeId: "f-rb" });
    expect(await row("/users/ada/FB/readme.md")).toMatchObject({ nodeId: "f-ra" });
    expect(await blobSize("users/ada/FA/readme.md")).toBe(2);
    expect(await blobSize("users/ada/FB/readme.md")).toBe(1);
  });

  it("a file swap keeps each document's page setup on the path it landed on", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await connect(server);
    await syncDriveTree(username);
    writeDocsPageSetupOverride("/users/ada/a.md", { format: "a4", orientation: "portrait" });
    writeDocsPageSetupOverride("/users/ada/b.md", { format: "a4", orientation: "landscape" });

    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });
    await syncDriveInboundFromFileNodes(username);

    const overrides = readDocsPageSetupOverrides();
    expect(overrides["/users/ada/b.md"]).toMatchObject({ orientation: "portrait" });
    expect(overrides["/users/ada/a.md"]).toMatchObject({ orientation: "landscape" });
  });

  it("a local rename of a shared-with-me root keeps it and its child share", async () => {
    await upsertDriveEntry(
      username,
      { ...staleEntry("/users/bob/Plans", "s-root"), type: "dir" },
      "share",
    );
    await upsertDriveEntry(username, staleEntry("/users/bob/Plans/c.md", "s-c"), "share");

    await migrateDriveEntryPath(username, "/users/bob/Plans", "/users/bob/Plans 2026");

    expect(await row("/users/bob/Plans 2026")).toMatchObject({ area: "share" });
    expect(await row("/users/bob/Plans 2026/c.md")).toMatchObject({ area: "share" });
  });
});

describe("a sync stopped between the two phases of a blob move", () => {
  const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;

  /** The second blob move throws: the first source is parked, the rest is not done. */
  async function stopAtSecondBlobMove() {
    const contentSync = await import("@/lib/offline/drive/drive-content-sync");
    const real = contentSync.migrateDriveContentBlobPath;
    let calls = 0;
    return vi
      .spyOn(contentSync, "migrateDriveContentBlobPath")
      .mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error("tab closed");
        return real(...args);
      });
  }

  it("the changes sync replays the swap and each blob lands on its own path", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    const tokenBefore = await readDriveSyncToken(username);
    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });

    const spy = await stopAtSecondBlobMove();
    await expect(syncDriveInboundFromFileNodes(username)).rejects.toThrow("tab closed");
    spy.mockRestore();
    expect(await readDriveSyncToken(username)).toBe(tokenBefore);
    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-a" });
    expect(await blobSize("users/ada/a.md")).toBe(1);

    await syncDriveInboundFromFileNodes(username);

    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });

  it("the tree pass resumes and each blob lands on its own path", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await upsertDriveEntry(username, staleEntry("/users/ada/a.md", "f-a"));
    await upsertDriveEntry(username, staleEntry("/users/ada/b.md", "f-b"));
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });
    await connect(server);

    const spy = await stopAtSecondBlobMove();
    await expect(syncDriveTree(username)).rejects.toThrow("tab closed");
    spy.mockRestore();
    expect(await blobSize("users/ada/a.md")).toBe(1);

    await syncDriveTree(username);

    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });
});

describe("the walk catch-up relocates in two phases", () => {
  it("two files that swap paths during the walk keep their own blobs", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    // A new pass; the swap lands after its first listing request.
    server.after.set(server.requests.length + 1, () => {
      server.move("f-a", { name: "b.md" });
      server.move("f-b", { name: "a.md" });
    });

    await syncDriveTree(username);

    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await row("/users/ada/b.md")).toMatchObject({ nodeId: "f-a" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });

  it("a full resync over two files swapped since the last pass keeps each file's blob and page setup", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    for (let i = 0; i < 40; i += 1)
      server.add(`n${String(i).padStart(3, "0")}`, "r-home", `f${i}.md`);
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    writeDocsPageSetupOverride("/users/ada/a.md", { format: "a4", orientation: "portrait" });
    writeDocsPageSetupOverride("/users/ada/b.md", { format: "a4", orientation: "landscape" });
    // Swapped before the pass starts: every page lists each file at the other's path.
    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });

    await syncDriveTree(username);

    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await row("/users/ada/b.md")).toMatchObject({ nodeId: "f-a" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
    const overrides = readDocsPageSetupOverrides();
    expect(overrides["/users/ada/a.md"]?.orientation).toBe("landscape");
    expect(overrides["/users/ada/b.md"]?.orientation).toBe("portrait");
    expect(await driveTreePrepassTable(db()).count()).toBe(0);
  });

  it("a tree pass stopped after its final write does not move the blobs again", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "a.md");
    server.add("f-b", "r-home", "b.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    server.move("f-a", { name: "b.md" });
    server.move("f-b", { name: "a.md" });
    const prune = await import("@/lib/offline/drive/drive-fetched-set-prune");
    const spy = vi
      .spyOn(prune, "pruneDriveEntriesToKeepSet")
      .mockRejectedValueOnce(new Error("tab closed"));

    await expect(syncDriveTree(username)).rejects.toThrow("tab closed");
    spy.mockRestore();
    await syncDriveTree(username);

    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await row("/users/ada/a.md")).toMatchObject({ nodeId: "f-b" });
    expect(await row("/users/ada/b.md")).toMatchObject({ nodeId: "f-a" });
    expect(await blobSize("users/ada/a.md")).toBe(2);
    expect(await blobSize("users/ada/b.md")).toBe(1);
  });

  it("a pre-pass map a crashed pass left behind does not cross the blobs", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "b.md");
    server.add("f-b", "r-home", "a.md");
    await connect(server);
    // The crashed pass already swapped rows and blobs, but its map survived.
    await upsertDriveEntry(username, staleEntry("/users/ada/b.md", "f-a"));
    await upsertDriveEntry(username, staleEntry("/users/ada/a.md", "f-b"));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["BB"]));
    await driveTreePrepassTable(db()).bulkPut([
      { nodeId: "f-a", paths: ["users/ada/a.md"] },
      { nodeId: "f-b", paths: ["users/ada/b.md"] },
    ]);
    await writeMeta(username, "drive:tree-sync:prepass", "1");

    await syncDriveTree(username);

    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await blobSize("users/ada/b.md")).toBe(1);
    expect(await blobSize("users/ada/a.md")).toBe(2);
  });

  it("local renames during the walk keep each blob with its node", async () => {
    const server = standardTree();
    server.add("f-a", "r-home", "final.md");
    server.add("f-b", "r-home", "draft.md");
    await connect(server);
    await syncDriveTree(username);
    await writeDriveContentBlob(username, "/users/ada/final.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/draft.md", new Blob(["BB"]));
    server.move("f-a", { name: "final-v1.md" });
    server.move("f-b", { name: "final.md" });
    // The person renames both files on this device while the pass runs.
    server.after.set(server.requests.length + 1, async () => {
      await applyDriveSidecarPathMigration(
        username,
        "/users/ada/final.md",
        "/users/ada",
        "final-v1.md",
      );
      await applyDriveSidecarPathMigration(
        username,
        "/users/ada/draft.md",
        "/users/ada",
        "final.md",
      );
    });

    await syncDriveTree(username);

    const blobSize = async (path: string) => (await driveContentBlobsTable(db()).get(path))?.size;
    expect(await row("/users/ada/final-v1.md")).toMatchObject({ nodeId: "f-a" });
    expect(await row("/users/ada/final.md")).toMatchObject({ nodeId: "f-b" });
    expect(await blobSize("users/ada/final-v1.md")).toBe(1);
    expect(await blobSize("users/ada/final.md")).toBe(2);
  });
});
