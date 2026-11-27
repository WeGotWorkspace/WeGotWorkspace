/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { moveDocsCollabPathDatabasesInBatch } from "./docs-collab-path-batch";
import { docsCollabRoomKey, indexedDbNamesForRoom } from "./docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

function v2Name(path: string): string {
  return indexedDbNamesForRoom(docsCollabRoomKey(path))[0]!;
}

async function seed(path: string, text: string, pending: boolean): Promise<void> {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("p");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  const persistence = new IndexeddbPersistence(v2Name(path), doc);
  await persistence.whenSynced;
  if (pending) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  doc.destroy();
}

async function read(path: string): Promise<string> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(v2Name(path), doc);
  await persistence.whenSynced;
  const text = doc.getXmlFragment("default").toString();
  await persistence.destroy();
  doc.destroy();
  return text;
}

describe("moveDocsCollabPathDatabasesInBatch", () => {
  it("swaps two Docs' local text", async () => {
    await seed("/users/alice/s1.md", "one", true);
    await seed("/users/alice/s2.md", "two", true);
    await moveDocsCollabPathDatabasesInBatch([
      { from: "/users/alice/s1.md", to: "/users/alice/s2.md" },
      { from: "/users/alice/s2.md", to: "/users/alice/s1.md" },
    ]);
    expect(await read("/users/alice/s1.md")).toContain("two");
    expect(await read("/users/alice/s2.md")).toContain("one");
  });

  it("keeps both texts when the destination is outside the batch and holds pending text", async () => {
    await seed("/users/alice/a.md", "from a", false);
    await seed("/users/alice/b.md", "offline doc", true);
    await moveDocsCollabPathDatabasesInBatch([
      { from: "/users/alice/a.md", to: "/users/alice/b.md" },
    ]);
    expect(await read("/users/alice/b.md")).toContain("offline doc");
    expect(await read("/users/alice/a.md")).toContain("from a");
  });
});
