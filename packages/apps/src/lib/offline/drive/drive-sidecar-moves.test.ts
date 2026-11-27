/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import "@/lib/offline/docs/docs-schema";
import { SidecarMoves } from "@/lib/offline/drive/drive-sidecar-moves";
import { driveContentBlobsTable } from "@/lib/offline/drive/drive-schema";
import "@/lib/offline/drive/drive-schema";

const USER = "sidecar-moves-user";

async function putBlob(id: string, text: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(USER));
  await driveContentBlobsTable(db).put({
    id,
    size: text.length,
    mimeType: "text/plain",
    syncedAt: 1,
    blob: new Blob([text]),
  });
}

async function blobIds(): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(USER));
  return (await driveContentBlobsTable(db).toArray()).map((row) => row.id).sort();
}

describe("SidecarMoves", () => {
  it("replays a journaled swap that stopped before apply", async () => {
    await putBlob("a.md", "a");
    await putBlob("b.md", "bb");
    const moves = new SidecarMoves();
    moves.add("a.md", "b.md");
    moves.add("b.md", "a.md");
    await moves.persist(USER);
    // The sync stops here: the rows are already at their final paths.
    await SidecarMoves.recover(USER);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(USER));
    expect(await blobIds()).toEqual(["a.md", "b.md"]);
    expect(await (await driveContentBlobsTable(db).get("a.md"))!.size).toBe(2);
    expect(await (await driveContentBlobsTable(db).get("b.md"))!.size).toBe(1);
    expect(await db.meta.where("key").startsWith("drive:sidecar-journal:").count()).toBe(0);
  });

  it("apply clears its journal, so a later recover moves nothing twice", async () => {
    await putBlob("c.md", "c");
    const moves = new SidecarMoves();
    moves.add("c.md", "d.md");
    await moves.persist(USER);
    await moves.apply(USER);
    await SidecarMoves.recover(USER);
    expect(await blobIds()).toContain("d.md");
    expect(await blobIds()).not.toContain("c.md");
  });
});
