import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import "@/lib/offline/drive/drive-schema";
import { driveEntriesTable, type OfflineDriveEntryRow } from "@/lib/offline/drive/drive-schema";
import { readCachedDrivePathForNodeId } from "@/lib/offline/drive/drive-directory-offline-store";

const ID = `fn-${"c".repeat(32)}`;

function row(id: string, type: "file" | "dir", nodeId?: string): OfflineDriveEntryRow {
  return {
    id,
    parentPath: id.split("/").slice(0, -1).join("/"),
    type,
    modifiedAt: 1,
    data: JSON.stringify({ path: `/${id}`, name: id.split("/").pop(), type }),
    ...(nodeId ? { nodeId } : {}),
  };
}

async function seed(username: string, rows: OfflineDriveEntryRow[]): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).bulkPut(rows);
}

describe("readCachedDrivePathForNodeId", () => {
  it("returns the path of the one file row with the id", async () => {
    await seed("lookup-one", [
      row("users/ada/Plans/roadmap.md", "file", ID),
      row("users/ada/other.md", "file", `fn-${"d".repeat(32)}`),
    ]);
    expect(await readCachedDrivePathForNodeId("lookup-one", ID)).toBe(
      "/users/ada/Plans/roadmap.md",
    );
  });

  it("returns undefined for an unknown id, a directory, or an empty id", async () => {
    await seed("lookup-none", [row("users/ada/Plans", "dir", ID)]);
    expect(await readCachedDrivePathForNodeId("lookup-none", ID)).toBeUndefined();
    expect(
      await readCachedDrivePathForNodeId("lookup-none", `fn-${"e".repeat(32)}`),
    ).toBeUndefined();
    expect(await readCachedDrivePathForNodeId("lookup-none", "  ")).toBeUndefined();
  });

  it("returns undefined when two file rows claim the same id", async () => {
    await seed("lookup-stale", [
      row("users/ada/old-name.md", "file", ID),
      row("users/ada/new-name.md", "file", ID),
    ]);
    expect(await readCachedDrivePathForNodeId("lookup-stale", ID)).toBeUndefined();
  });
});
