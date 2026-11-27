/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { getDriveSyncRunner } from "@/lib/offline/drive/drive-hybrid-operations";

const renameItem = vi.fn();
const setStar = vi.fn();
const calls: string[] = [];

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({ renameItem, setStar })),
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
});
