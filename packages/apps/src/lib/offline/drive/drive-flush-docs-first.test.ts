/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { writeDocsAvailability } from "@/lib/offline/docs/docs-availability-store";
import {
  readCachedDriveNodeId,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import {
  createHybridDriveOperations,
  getDriveSyncRunner,
} from "@/lib/offline/drive/drive-hybrid-operations";

const renameItem = vi.fn();
const setStar = vi.fn();
const calls: string[] = [];

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({ renameItem, setStar })),
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: vi.fn(() => true),
}));

const createDriveFileKeepingBoth = vi.fn();
vi.mock("@/lib/api/wgw/drive-create-keep-both", () => ({
  createDriveFileKeepingBoth: (...args: unknown[]) => createDriveFileKeepingBoth(...args),
}));

vi.mock("@/lib/offline/docs/docs-path-moves", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/docs/docs-path-moves")>()),
  moveDocsPath: vi.fn(async () => undefined),
}));

describe("a Drive outbox flush and a queued Docs create (#2063 C4)", () => {
  const username = "alice";

  beforeEach(async () => {
    renameItem.mockReset();
    setStar.mockReset();
    createDriveFileKeepingBoth.mockReset();
    calls.length = 0;
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).outbox.clear();
    createDriveFileKeepingBoth.mockImplementation(async () => {
      calls.push("create");
      return "Plan (1).md";
    });
    renameItem.mockImplementation(async () => {
      calls.push("rename");
    });
  });

  async function queueCreate() {
    await enqueueOutboxMutation(username, {
      id: "create-1",
      domain: DOCS_DOMAIN,
      op: "create",
      payload: JSON.stringify({ op: "create", apiPath: "/users/alice/Plan.md", content: "# mine" }),
    });
  }

  it("sends the create first and aims a queued trash at the kept name", async () => {
    await queueCreate();
    await enqueueOutboxMutation(username, {
      id: "drive-trash",
      domain: DRIVE_DOMAIN,
      op: "trash",
      payload: JSON.stringify({
        op: "trash",
        from: "/users/alice/Plan.md",
        destination: "/users/alice/.Trash",
        to: "Plan.md",
      }),
    });

    await getDriveSyncRunner(username).flush();

    expect(calls).toEqual(["create", "rename"]);
    expect(renameItem.mock.calls[0]![0]).toMatchObject({ from: "/users/alice/Plan (1).md" });
  });

  it("sends the create first and aims a queued rename at the kept name", async () => {
    await queueCreate();
    await enqueueOutboxMutation(username, {
      id: "drive-rename",
      domain: DRIVE_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/Plan.md",
        destination: "/users/alice",
        to: "Renamed.md",
      }),
    });

    await getDriveSyncRunner(username).flush();

    expect(calls).toEqual(["create", "rename"]);
    expect(renameItem.mock.calls[0]![0]).toMatchObject({ from: "/users/alice/Plan (1).md" });
  });
  it("online, a rename of a Doc whose create is queued waits for the create (#2063 C4)", async () => {
    await queueCreate();

    // Online: sent now, it would rename the server's own Plan.md.
    await createHybridDriveOperations(username, null).renameItem({
      from: "/users/alice/Plan.md",
      destination: "/users/alice",
      to: "Renamed.md",
    });
    await getDriveSyncRunner(username).flush();

    expect(calls).toEqual(["create", "rename"]);
    expect(renameItem.mock.calls[0]![0]).toMatchObject({ from: "/users/alice/Plan (1).md" });
  });

  async function seedServerFile() {
    await upsertDriveEntry(username, {
      type: "file",
      path: "/users/alice/Plan.md",
      name: "Plan.md",
      size: 1,
      time: 1,
      permissions: 0,
      nodeId: "fn-server",
    } as WgwDriveDirectoryEntry);
    await writeDocsAvailability(username, {
      id: "/users/alice/Plan.md",
      location: "",
      nodeId: "fn-server",
    });
  }

  it("online, a rename leaves the server's file on its row while the create is queued (#2063 C4)", async () => {
    await seedServerFile();
    await queueCreate();

    await createHybridDriveOperations(username, null).renameItem({
      from: "/users/alice/Plan.md",
      destination: "/users/alice",
      to: "Renamed.md",
    });
    await getDriveSyncRunner(username).flush();

    expect(await readCachedDriveNodeId(username, "users/alice/Plan.md")).toBe("fn-server");
    expect(renameItem.mock.calls[0]![0]).toMatchObject({ from: "/users/alice/Plan (1).md" });
  });

  it("online, a trash leaves the server's file on its row while the create is queued (#2063 C4)", async () => {
    await seedServerFile();
    await queueCreate();

    await createHybridDriveOperations(username, null).renameItem({
      from: "/users/alice/Plan.md",
      destination: "/users/alice/.Trash",
      to: "Plan.md",
    });
    await getDriveSyncRunner(username).flush();

    expect(await readCachedDriveNodeId(username, "users/alice/Plan.md")).toBe("fn-server");
    expect(renameItem.mock.calls[0]![0]).toMatchObject({ from: "/users/alice/Plan (1).md" });
  });

  it("online, a star of a Doc whose create is queued waits for the create (#2063 C4)", async () => {
    await queueCreate();
    setStar.mockImplementation(async () => {
      calls.push("star");
    });

    await createHybridDriveOperations(username, null).setStar({
      path: "/users/alice/Plan.md",
      starred: true,
    });
    await getDriveSyncRunner(username).flush();

    expect(calls).toEqual(["create", "star"]);
    expect(setStar.mock.calls[0]![0]).toMatchObject({ path: "/users/alice/Plan (1).md" });
  });
});
