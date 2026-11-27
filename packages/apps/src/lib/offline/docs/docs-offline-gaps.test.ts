import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { retargetDocsOutboxPayload } from "@/lib/offline/docs/docs-create-kept-both";
import {
  docsPathAfterMove,
  moveDocsPath,
  subscribeDocsPathMoved,
} from "@/lib/offline/docs/docs-path-moves";
import {
  docsCollabIndexedDbKey,
  listExistingIndexedDatabaseNames,
  moveDocsCollabPathDatabases,
} from "@/lib/collab/docs-collab-persistence";

// Docs offline gaps (#1563 step 2): text and writes follow a moved Doc. Trash
// and Starred offline are views of the Drive tree since #2063 C4
// (docs-home-binding.test.tsx).

const username = "alice";

async function writeText(databaseName: string, text: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(databaseName, ydoc);
  await persistence.whenSynced;
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  ydoc.getXmlFragment("default").insert(0, [paragraph]);
  await persistence.destroy();
  ydoc.destroy();
}

async function readText(databaseName: string): Promise<string> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(databaseName, ydoc);
  await persistence.whenSynced;
  const fragment = ydoc.getXmlFragment("default");
  const text = fragment
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.toArray().join("") : ""))
    .join("");
  await persistence.destroy();
  ydoc.destroy();
  return text;
}

describe("docsPathAfterMove", () => {
  it("maps the file itself and paths under a moved folder", () => {
    expect(docsPathAfterMove("/users/a/x.md", "users/a/x.md", "/users/a/y.md")).toBe(
      "users/a/y.md",
    );
    expect(docsPathAfterMove("users/a/F/x.md", "/users/a/F", "/users/a/G")).toBe("users/a/G/x.md");
    expect(docsPathAfterMove("users/a/Fx.md", "users/a/F", "users/a/G")).toBeNull();
    expect(docsPathAfterMove("users/a/other.md", "users/a/x.md", "users/a/y.md")).toBeNull();
  });
});

describe("moveDocsCollabPathDatabases", () => {
  it("moves path-keyed text to the new path and marks it unsaved", async () => {
    await writeText(docsCollabIndexedDbKey("users/a/Move me.md"), "typed offline");

    await expect(
      moveDocsCollabPathDatabases("/users/a/Move me.md", "/users/a/Moved.md"),
    ).resolves.toBe(true);

    expect(await readText(docsCollabIndexedDbKey("users/a/Moved.md"))).toBe("typed offline");
    expect(await readText(docsCollabIndexedDbKey("users/a/Move me.md"))).toBe("");
  });

  it("moves text of Docs under a renamed folder", async () => {
    await writeText(docsCollabIndexedDbKey("users/a/Folder/inner.md"), "inner text");

    await moveDocsCollabPathDatabases("users/a/Folder", "users/a/Renamed");

    expect(await readText(docsCollabIndexedDbKey("users/a/Renamed/inner.md"))).toBe("inner text");
  });

  it("opens nothing when the old path has no database", async () => {
    await expect(
      moveDocsCollabPathDatabases("users/a/none.md", "users/a/still-none.md"),
    ).resolves.toBe(false);
    const names = await listExistingIndexedDatabaseNames();
    expect(names?.has(docsCollabIndexedDbKey("users/a/none.md"))).toBe(false);
    expect(names?.has(docsCollabIndexedDbKey("users/a/still-none.md"))).toBe(false);
  });
});

describe("moveDocsPath", () => {
  it("moves the text first, then tells every tab", async () => {
    await writeText(docsCollabIndexedDbKey("users/alice/Before.md"), "kept");
    const heard: Array<[string, string, string]> = [];
    const unsubscribe = subscribeDocsPathMoved(username, (from, to) => {
      heard.push([from, to, ""]);
      void readText(docsCollabIndexedDbKey(to)).then((text) => {
        heard[heard.length - 1]![2] = text;
      });
    });

    await moveDocsPath(username, "/users/alice/Before.md", "/users/alice/After.md");
    await expect.poll(() => heard[0]?.[2]).toBe("kept");
    unsubscribe();

    expect(heard[0]!.slice(0, 2)).toEqual(["users/alice/Before.md", "users/alice/After.md"]);
  });

  it("does nothing for the same path", async () => {
    const heard: string[] = [];
    const unsubscribe = subscribeDocsPathMoved(username, (from) => heard.push(from));
    await moveDocsPath(username, "users/alice/Same.md", "/users/alice/Same.md/");
    unsubscribe();
    expect(heard).toEqual([]);
  });
});

describe("retargetDocsOutboxPayload", () => {
  const from = "/users/a/Plan.md";
  const to = "/users/a/Plan (1).md";

  it("points every queued op on the kept-both path at its new name", () => {
    expect(
      retargetDocsOutboxPayload(
        { op: "rename", from, destination: "/users/a", to: "Next.md" },
        from,
        to,
      ),
    ).toEqual({ op: "rename", from: to, destination: "/users/a", to: "Next.md" });
    expect(retargetDocsOutboxPayload({ op: "star", path: from, starred: true }, from, to)).toEqual({
      op: "star",
      path: to,
      starred: true,
    });
    expect(
      retargetDocsOutboxPayload({ op: "create", apiPath: from, content: "x" }, from, to),
    ).toEqual({ op: "create", apiPath: to, content: "x" });
  });

  it("leaves other paths alone", () => {
    const payload = { op: "star" as const, path: "/users/a/Other.md", starred: true };
    expect(retargetDocsOutboxPayload(payload, from, to)).toBe(payload);
  });
});
