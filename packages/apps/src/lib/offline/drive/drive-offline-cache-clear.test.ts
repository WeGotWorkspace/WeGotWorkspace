/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDriveAvailability,
  writeDriveAvailability,
} from "@/lib/offline/drive/drive-availability-store";
import { writeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { clearAutoOfflineCopies } from "@/lib/offline/drive/drive-offline-cache-clear";
import {
  DRIVE_DOMAIN,
  driveAvailabilityTable,
  driveContentBlobsTable,
} from "@/lib/offline/drive/drive-schema";

const username = "alice";

async function cached(path: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return (await driveContentBlobsTable(db).get(path)) !== undefined;
}

describe("clearAutoOfflineCopies", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveContentBlobsTable(db).clear();
    await driveAvailabilityTable(db).clear();
    await db.outbox.clear();
  });

  it("removes copies background sync saved and keeps the ones saved by hand", async () => {
    await writeDriveContentBlob(username, "users/alice/auto.pdf", new Blob(["a"]));
    await writeDriveContentBlob(username, "users/alice/pinned.pdf", new Blob(["b"]));
    await writeDriveAvailability(username, { id: "users/alice/pinned.pdf", source: "manual" });

    const { removedPaths } = await clearAutoOfflineCopies(username);

    expect(removedPaths).toEqual(["users/alice/auto.pdf"]);
    expect(await cached("users/alice/auto.pdf")).toBe(false);
    expect(await readDriveAvailability(username, "users/alice/auto.pdf")).toBeUndefined();
    expect(await cached("users/alice/pinned.pdf")).toBe(true);
  });

  it("keeps an automatic copy that an open outbox write still points at", async () => {
    await writeDriveContentBlob(username, "users/alice/report.pdf", new Blob(["r"]));
    await enqueueOutboxMutation(username, {
      id: "rename-1",
      domain: DRIVE_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/report.pdf",
        destination: "/users/alice",
        to: "final.pdf",
      }),
    });

    const { removedPaths } = await clearAutoOfflineCopies(username);

    expect(removedPaths).toEqual([]);
    expect(await cached("users/alice/report.pdf")).toBe(true);
  });

  it("leaves Docs documents alone: their local copy is the editor's store", async () => {
    await writeDriveAvailability(username, { id: "users/alice/notes.md", source: "auto" });

    const { removedPaths } = await clearAutoOfflineCopies(username);

    expect(removedPaths).toEqual([]);
    expect(await readDriveAvailability(username, "users/alice/notes.md")).toBeDefined();
  });
});
