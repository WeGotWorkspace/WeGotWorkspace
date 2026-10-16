import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { WgwOfflineDatabase } from "@/lib/offline/core/offline-db";
import "@/lib/offline/docs/docs-schema";
import "@/lib/offline/drive/drive-schema";
import { docsAvailabilityTable } from "@/lib/offline/docs/docs-schema";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { readCachedDriveNodeId } from "@/lib/offline/drive/drive-directory-offline-store";

const dbName = (key: string) => `wgw-offline-${key}`;

describe("offline cache nodeId upgrade", () => {
  it("keeps rows that have no nodeId when upgrading into the new indexes", async () => {
    const account = "upgrade-node-id";
    const legacy = new Dexie(dbName(account));
    const stores = {
      meta: "key",
      outbox: "id, domain, createdAt",
      docs_listing_rows: "id, cacheKey, modifiedAt, sortIndex",
      docs_availability: "id, pinnedAt, lastSyncedAt, location",
      drive_entries: "id, parentPath, type, modifiedAt",
      drive_content_blobs: "id, size, syncedAt",
      drive_availability: "id, source, pinnedAt, lastSyncedAt",
    };
    legacy.version(1).stores({ meta: "key", outbox: "id, domain, createdAt" });
    legacy.version(21).stores({
      meta: stores.meta,
      outbox: stores.outbox,
      docs_listing_rows: stores.docs_listing_rows,
      docs_availability: stores.docs_availability,
    });
    legacy.version(32).stores(stores);
    await legacy.open();
    await legacy.table("drive_entries").put({
      id: "users/ada/old.md",
      parentPath: "users/ada",
      type: "file",
      modifiedAt: 1,
      data: JSON.stringify({ path: "/users/ada/old.md", name: "old.md", type: "file" }),
    });
    await legacy.table("docs_availability").put({
      id: "users/ada/old.md",
      pinnedAt: 1,
      lastSyncedAt: null,
      location: "My Drive",
    });
    legacy.close();

    const db = new WgwOfflineDatabase(account);
    await db.open();

    const driveRow = await driveEntriesTable(db).get("users/ada/old.md");
    expect(driveRow?.id).toBe("users/ada/old.md");
    expect(driveRow?.nodeId).toBeUndefined();
    expect(await readCachedDriveNodeId("upgrade-node-id", "users/ada/old.md")).toBeUndefined();

    const pin = await docsAvailabilityTable(db).get("users/ada/old.md");
    expect(pin?.id).toBe("users/ada/old.md");
    expect(pin?.nodeId).toBeUndefined();

    await driveEntriesTable(db).put({ ...driveRow!, nodeId: "fn-later" });
    expect(await readCachedDriveNodeId("upgrade-node-id", "users/ada/old.md")).toBe("fn-later");

    await db.delete();
  });
});
