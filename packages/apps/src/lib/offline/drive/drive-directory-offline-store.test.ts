import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";

const username = "alice";
const table = () => driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));

function entry(path: string, type: "dir" | "file", nodeId: string): WgwDriveDirectoryEntry {
  return {
    path,
    name: path.split("/").pop()!,
    type,
    size: 0,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
    nodeId,
  };
}

const upload = { id: "up-1", batchId: "b-1", status: "uploading" as const };

describe("upsertDriveEntry", () => {
  beforeEach(async () => {
    await table().clear();
  });

  it("keeps the upload marker of a folder that is still taking an upload (#1620)", async () => {
    const folder = entry("/users/alice/Trip", "dir", "fn-trip");
    await table().put({
      id: "users/alice/Trip",
      parentPath: "users/alice",
      type: "dir",
      modifiedAt: 1,
      nodeId: "fn-trip",
      uploadId: upload.id,
      data: JSON.stringify({ ...folder, upload }),
    });

    await upsertDriveEntry(username, { ...folder, time: 2 });

    const row = await table().get("users/alice/Trip");
    expect(row?.uploadId).toBe(upload.id);
    expect(row?.modifiedAt).toBe(2);
    expect(JSON.parse(row!.data)).toMatchObject({ time: 2, upload });
  });

  it("writes the server row over a file placeholder and over a plain folder", async () => {
    const file = entry("/users/alice/a.txt", "file", "fn-a");
    await table().put({
      id: "users/alice/a.txt",
      parentPath: "users/alice",
      type: "file",
      modifiedAt: 1,
      uploadId: upload.id,
      data: JSON.stringify({ ...file, upload }),
    });
    await upsertDriveEntry(username, entry("/users/alice/Docs", "dir", "fn-docs"));

    await upsertDriveEntry(username, file);
    await upsertDriveEntry(username, { ...entry("/users/alice/Docs", "dir", "fn-docs"), time: 3 });

    const fileRow = await table().get("users/alice/a.txt");
    expect(fileRow?.uploadId).toBeUndefined();
    expect(JSON.parse(fileRow!.data).upload).toBeUndefined();
    const docsRow = await table().get("users/alice/Docs");
    expect(docsRow?.uploadId).toBeUndefined();
    expect(docsRow?.modifiedAt).toBe(3);
  });
});
