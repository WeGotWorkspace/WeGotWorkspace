import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDriveAppBootstrap, fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { DriveAPIOperations, DriveAppBootstrap } from "@/lib/files/drive-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import { docsOfflineDomainStore } from "@/lib/offline/docs/docs-domain-contract";
import {
  driveHybridDomainOperations,
  driveOfflineDomainStore,
} from "@/lib/offline/drive/drive-domain-contract";
import { readDriveEntryFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { readDriveSyncToken } from "@/lib/offline/drive/drive-inbound-sync";

const username = "carol";
const report: WgwDriveDirectoryEntry = {
  path: "/users/carol/report.md",
  name: "report.md",
  type: "file",
  size: 12,
  time: 1,
  permissions: 0,
  myRights: fullDriveMyRights,
  nodeId: "fn-report",
};

const store: OfflineDomainStore<DriveAppBootstrap, WgwDriveDirectoryEntry> =
  driveOfflineDomainStore;
const operations: OfflineDomainOperations<DriveAPIOperations> = driveHybridDomainOperations;

describe("drive domain contract", () => {
  it("round-trips the bootstrap", async () => {
    const bootstrap = createDriveAppBootstrap();
    await store.writeBootstrap(username, bootstrap);
    await expect(store.readBootstrap(username)).resolves.toEqual(bootstrap);
  });

  it("upserts and removes a file entry by its API path", async () => {
    await store.upsertEntity(username, report);
    expect((await readDriveEntryFromCache(username, report.path))?.nodeId).toBe("fn-report");
    await store.removeEntity(username, report.path);
    await expect(readDriveEntryFromCache(username, report.path)).resolves.toBeNull();
  });

  it("keeps one FileNode token for the whole account", async () => {
    await store.writeSyncToken(username, "users/carol", "state-7");
    await expect(store.readSyncToken(username, "groups/team")).resolves.toBe("state-7");
    await expect(readDriveSyncToken(username)).resolves.toBe("state-7");
  });

  it("is the store Docs binds too", () => {
    expect(docsOfflineDomainStore).toBe(driveOfflineDomainStore);
  });

  it("builds the hybrid Drive operations", () => {
    expect(operations(username).listDirectory).toBeTypeOf("function");
  });
});
