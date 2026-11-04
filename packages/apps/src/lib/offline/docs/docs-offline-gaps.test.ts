import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { retargetDocsOutboxPayload } from "@/lib/offline/docs/docs-create-kept-both";
import {
  forgetDocsLiveDirectories,
  readDocsOfflineDirectory,
  readDocsOfflineEntriesByPaths,
  rememberDocsLiveDirectory,
} from "@/lib/offline/docs/docs-offline-entries";
import {
  docsPathAfterMove,
  moveDocsPath,
  subscribeDocsPathMoved,
} from "@/lib/offline/docs/docs-path-moves";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import "@/lib/offline/drive/drive-schema";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  docsCollabIndexedDbKey,
  listExistingIndexedDatabaseNames,
  moveDocsCollabPathDatabases,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

// Docs offline gaps (#1563 step 2): text and writes follow a moved Doc, and
// Trash and Starred are read from this device while offline.

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

function entry(path: string, size = 1): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path,
    name: path.split("/").pop() ?? path,
    size,
    time: 1,
    permissions: 0,
  } as WgwDriveDirectoryEntry;
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

describe("Docs offline directory and entries", () => {
  beforeEach(async () => {
    forgetDocsLiveDirectories();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.table("drive_entries").clear();
  });

  it("lists Trash with a Doc trashed offline and the last live listing", async () => {
    await upsertDriveEntry(username, entry("/users/alice/.Trash/Cached.md"));
    rememberDocsLiveDirectory(username, "/users/alice/.Trash", [
      entry("/users/alice/.Trash/Listed.md"),
    ]);
    await enqueueOutboxMutation(username, {
      id: "trash-offline",
      domain: DOCS_DOMAIN,
      op: "trash",
      payload: JSON.stringify({
        op: "trash",
        from: "/users/alice/Gone.md",
        destination: "/users/alice/.Trash",
        to: "Gone.md",
      }),
    });

    const trash = await readDocsOfflineDirectory(username, "users/alice/.Trash");

    expect(trash.cwd).toBe("/users/alice/.Trash");
    expect(trash.directory.files.map((file) => file.path).sort()).toEqual([
      "/users/alice/.Trash/Cached.md",
      "/users/alice/.Trash/Gone.md",
      "/users/alice/.Trash/Listed.md",
    ]);
  });

  it("drops a Doc a queued move took out of the folder", async () => {
    rememberDocsLiveDirectory(username, "/users/alice/.Trash", [
      entry("/users/alice/.Trash/Restore.md"),
    ]);
    await enqueueOutboxMutation(username, {
      id: "restore-offline",
      domain: DOCS_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/.Trash/Restore.md",
        destination: "/users/alice",
        to: "Restore.md",
      }),
    });

    const trash = await readDocsOfflineDirectory(username, "/users/alice/.Trash");
    const home = await readDocsOfflineDirectory(username, "/users/alice");

    expect(trash.directory.files).toEqual([]);
    expect(home.directory.files.map((file) => file.path)).toEqual(["/users/alice/Restore.md"]);
  });

  it("gives every starred path an entry, from the Drive cache when it has one", async () => {
    await upsertDriveEntry(username, entry("/users/alice/Known.md", 42));

    const entries = await readDocsOfflineEntriesByPaths(username, [
      "/users/alice/Known.md",
      "users/alice/Unknown.md",
    ]);

    expect(entries.map((item) => [item.path, item.size])).toEqual([
      ["/users/alice/Known.md", 42],
      ["/users/alice/Unknown.md", 0],
    ]);
  });
});
