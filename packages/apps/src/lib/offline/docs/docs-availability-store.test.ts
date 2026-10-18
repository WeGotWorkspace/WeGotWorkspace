import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import "@/lib/offline/docs/docs-schema";
import {
  listDocsAvailability,
  migrateDocsAvailabilityPath,
  moveDocsAvailabilityForNode,
  readDocsAvailability,
  removeDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";

describe("docs-availability-store", () => {
  const username = "ada";

  beforeEach(async () => {
    const { offlineDbForAccount, offlineAccountKeyFromUsername } =
      await import("@/lib/offline/core/offline-db");
    const { docsAvailabilityTable } = await import("@/lib/offline/docs/docs-schema");
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await docsAvailabilityTable(db).clear();
  });

  it("writes, lists, and removes availability rows", async () => {
    await writeDocsAvailability(username, {
      id: "users/ada/note.md",
      location: "My Drive",
    });
    await markSynced(username);

    const rows = await listDocsAvailability(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("users/ada/note.md");
    expect(rows[0]?.location).toBe("My Drive");
    expect(rows[0]?.lastSyncedAt).toBeTypeOf("number");

    await removeDocsAvailability(username, "users/ada/note.md");
    expect(await listDocsAvailability(username)).toHaveLength(0);
  });

  it("keeps the FileNode id when a pin is written again", async () => {
    await writeDocsAvailability(username, {
      id: "users/ada/note.md",
      location: "My Drive",
      nodeId: "fn-note",
    });
    await writeDocsAvailability(username, { id: "users/ada/note.md", location: "Shared" });

    await expect(readDocsAvailability(username, "users/ada/note.md")).resolves.toMatchObject({
      location: "Shared",
      nodeId: "fn-note",
    });
  });

  it("moves the pin of a FileNode to its new path, wherever the pin was", async () => {
    await writeDocsAvailability(username, {
      id: "users/ada/stale.md",
      location: "My Drive",
      nodeId: "fn-moved",
    });

    await moveDocsAvailabilityForNode(username, "fn-moved", "/users/ada/new/place.md");

    await expect(readDocsAvailability(username, "users/ada/stale.md")).resolves.toBeUndefined();
    await expect(readDocsAvailability(username, "users/ada/new/place.md")).resolves.toMatchObject({
      nodeId: "fn-moved",
      location: "My Drive",
    });
  });

  it("migrates availability path on rename", async () => {
    await writeDocsAvailability(username, {
      id: "users/ada/old.md",
      location: "My Drive",
    });
    await migrateDocsAvailabilityPath(username, "users/ada/old.md", "users/ada/new.md");
    expect(await readDocsAvailability(username, "users/ada/old.md")).toBeUndefined();
    expect(await readDocsAvailability(username, "users/ada/new.md")).toBeTruthy();
  });
});

async function markSynced(username: string): Promise<void> {
  const { markDocsAvailabilitySynced } = await import("@/lib/offline/docs/docs-availability-store");
  await markDocsAvailabilitySynced(username, "users/ada/note.md");
}
