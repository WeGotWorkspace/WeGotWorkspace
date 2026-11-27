import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { moveDocsCollabPathDatabasesInBatch } from "./docs-collab-path-batch";
import { docsCollabIndexedDbKey, docsCollabRoomKey } from "./docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

const nameOf = (path: string) => docsCollabIndexedDbKey(docsCollabRoomKey(path));

async function writeText(path: string, text: string, pending: boolean): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(nameOf(path), ydoc);
  await persistence.whenSynced;
  const paragraph = new Y.XmlText();
  paragraph.insert(0, text);
  ydoc.getXmlFragment("default").insert(0, [paragraph]);
  if (pending) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function readText(path: string): Promise<{ text: string; pending: boolean }> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(nameOf(path), ydoc);
  await persistence.whenSynced;
  const text = ydoc.getXmlFragment("default").toString();
  const pending = Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY));
  await persistence.destroy();
  ydoc.destroy();
  return { text, pending };
}

describe("moveDocsCollabPathDatabasesInBatch", () => {
  it("never overwrites unsaved text at a destination that is not a source", async () => {
    // b.md was created offline (unsaved); a.md was opened before its id was known.
    await writeText("/users/ada/one/b.md", "offline text of b", true);
    await writeText("/users/ada/one/a.md", "body of a", false);

    await moveDocsCollabPathDatabasesInBatch([
      { from: "/users/ada/one/a.md", to: "/users/ada/one/b.md" },
    ]);

    expect(await readText("/users/ada/one/b.md")).toEqual({
      text: "offline text of b",
      pending: true,
    });
    expect((await readText("/users/ada/one/a.md")).text).toBe("body of a");
  });

  it("a move onto a source that stays is skipped too, down the chain", async () => {
    // b.md has unsaved offline text, so a→b is skipped and a stays; c→a would
    // then overwrite a's text, so it is skipped as well and c stays.
    await writeText("/users/ada/chain/b.md", "offline text of b", true);
    await writeText("/users/ada/chain/a.md", "text of a", false);
    await writeText("/users/ada/chain/c.md", "text of c", true);

    await moveDocsCollabPathDatabasesInBatch([
      { from: "/users/ada/chain/a.md", to: "/users/ada/chain/b.md" },
      { from: "/users/ada/chain/c.md", to: "/users/ada/chain/a.md" },
    ]);

    expect(await readText("/users/ada/chain/b.md")).toEqual({
      text: "offline text of b",
      pending: true,
    });
    expect((await readText("/users/ada/chain/a.md")).text).toBe("text of a");
    expect(await readText("/users/ada/chain/c.md")).toEqual({
      text: "text of c",
      pending: true,
    });
  });

  it("gives a destination its source's text alone and clears a vacated source", async () => {
    await writeText("/users/ada/two/a.md", "text of a", true);
    await writeText("/users/ada/two/b.md", "text of b", true);
    await writeText("/users/ada/two/c.md", "text of c", true);

    await moveDocsCollabPathDatabasesInBatch([
      { from: "/users/ada/two/a.md", to: "/users/ada/two/b.md" },
      { from: "/users/ada/two/b.md", to: "/users/ada/two/a.md" },
      { from: "/users/ada/two/c.md", to: "/users/ada/two/d.md" },
    ]);

    expect((await readText("/users/ada/two/b.md")).text).toBe("text of a");
    expect((await readText("/users/ada/two/a.md")).text).toBe("text of b");
    expect(await readText("/users/ada/two/d.md")).toEqual({ text: "text of c", pending: true });
    expect(await readText("/users/ada/two/c.md")).toEqual({ text: "", pending: false });
  });
});
