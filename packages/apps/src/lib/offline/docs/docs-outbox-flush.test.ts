import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import {
  readCachedDriveNodeId,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import "@/lib/offline/drive/drive-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  flushDocsOutbox,
  removeOutboxMutationsForDocsPath,
} from "@/lib/offline/docs/docs-outbox-flush";

const renameItem = vi.fn();
const uploadFiles = vi.fn();
const setStar = vi.fn();

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    renameItem,
    uploadFiles,
    setStar,
  })),
}));

const createDriveFileKeepingBoth = vi.fn();
vi.mock("@/lib/api/wgw/drive-create-keep-both", () => ({
  createDriveFileKeepingBoth: (...args: unknown[]) => createDriveFileKeepingBoth(...args),
}));

const moveDocsPath = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/offline/docs/docs-path-moves", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/docs/docs-path-moves")>()),
  moveDocsPath: (...args: unknown[]) => moveDocsPath(...args),
}));

describe("flushDocsOutbox", () => {
  const username = "alice";

  beforeEach(async () => {
    renameItem.mockReset();
    uploadFiles.mockReset();
    setStar.mockReset();
    createDriveFileKeepingBoth.mockReset();
    moveDocsPath.mockClear();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("reports state mismatches for 409/412 drive failures", async () => {
    await enqueueOutboxMutation(username, {
      id: "rename-1",
      domain: DOCS_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/doc.md",
        destination: "/users/alice",
        to: "doc-renamed.md",
      }),
    });

    renameItem.mockRejectedValue(Object.assign(new Error("Precondition failed"), { status: 412 }));

    const result = await flushDocsOutbox(username);

    expect(result.flushed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.stateMismatches).toEqual(["users/alice/doc.md"]);
  });

  it("moves the cached nodeId when a queued Docs rename flushes", async () => {
    const oldPath = "/users/alice/queued.md";
    const entry: WgwDriveDirectoryEntry = {
      type: "file",
      path: oldPath,
      name: "queued.md",
      size: 1,
      time: 1,
      permissions: 0,
      nodeId: "fn-queued",
      myRights: {
        mayView: true,
        mayComment: false,
        mayReview: false,
        mayEditContent: true,
        mayManageStructure: true,
        mayShare: false,
      },
    };
    await upsertDriveEntry(username, entry);
    await enqueueOutboxMutation(username, {
      id: "rename-node",
      domain: DOCS_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: oldPath,
        destination: "/users/alice",
        to: "queued-renamed.md",
      }),
    });
    renameItem.mockResolvedValue(undefined);

    await flushDocsOutbox(username);

    expect(await readCachedDriveNodeId(username, "users/alice/queued-renamed.md")).toBe(
      "fn-queued",
    );
    expect(await readCachedDriveNodeId(username, oldPath)).toBeUndefined();
  });

  it("reports when removing a path drops a queued trash", async () => {
    await enqueueOutboxMutation(username, {
      id: "trash-1",
      domain: DOCS_DOMAIN,
      op: "trash",
      payload: JSON.stringify({
        op: "trash",
        from: "/users/alice/B.md",
        destination: "/users/alice/.Trash",
        to: "B.md",
      }),
    });

    await expect(removeOutboxMutationsForDocsPath(username, "/users/alice/B.md")).resolves.toBe(
      true,
    );
    await expect(removeOutboxMutationsForDocsPath(username, "/users/alice/B.md")).resolves.toBe(
      false,
    );
  });

  it("keeps both when an offline create's name was taken, and later writes follow it (#1563)", async () => {
    await enqueueOutboxMutation(username, {
      id: "create-1",
      domain: DOCS_DOMAIN,
      op: "create",
      payload: JSON.stringify({ op: "create", apiPath: "/users/alice/Plan.md", content: "# mine" }),
    });
    await enqueueOutboxMutation(username, {
      id: "star-after-create",
      domain: DOCS_DOMAIN,
      op: "star",
      payload: JSON.stringify({ op: "star", path: "/users/alice/Plan.md", starred: true }),
    });
    createDriveFileKeepingBoth.mockResolvedValue("Plan (1).md");

    const result = await flushDocsOutbox(username);

    expect(result).toMatchObject({ flushed: 2, failed: 0 });
    const [parent, file, opts] = createDriveFileKeepingBoth.mock.calls[0]!;
    expect(parent).toBe("/users/alice");
    expect((file as File).name).toBe("Plan.md");
    expect(await (file as File).text()).toBe("# mine");
    expect(opts).toEqual({ mayHaveLanded: false });
    expect(moveDocsPath).toHaveBeenCalledWith(
      username,
      "/users/alice/Plan.md",
      "/users/alice/Plan (1).md",
    );
    expect(setStar).toHaveBeenCalledWith({ path: "/users/alice/Plan (1).md", starred: true });
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("tells the create that a retried row may have landed already", async () => {
    await enqueueOutboxMutation(username, {
      id: "create-retry",
      domain: DOCS_DOMAIN,
      op: "create",
      payload: JSON.stringify({ op: "create", apiPath: "/users/alice/Retry.md", content: "x" }),
    });
    createDriveFileKeepingBoth.mockRejectedValueOnce(new Error("Failed to fetch"));
    await flushDocsOutbox(username);
    createDriveFileKeepingBoth.mockResolvedValueOnce("Retry.md");

    const result = await flushDocsOutbox(username);

    expect(result).toMatchObject({ flushed: 1, failed: 0 });
    expect(createDriveFileKeepingBoth.mock.calls[1]![2]).toEqual({ mayHaveLanded: true });
    expect(moveDocsPath).not.toHaveBeenCalled();
  });

  it("does not report a trash when the removed op is not trash", async () => {
    await enqueueOutboxMutation(username, {
      id: "star-1",
      domain: DOCS_DOMAIN,
      op: "star",
      payload: JSON.stringify({ op: "star", path: "/users/alice/B.md", starred: true }),
    });

    await expect(removeOutboxMutationsForDocsPath(username, "/users/alice/B.md")).resolves.toBe(
      false,
    );
  });
});
