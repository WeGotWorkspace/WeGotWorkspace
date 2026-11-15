import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parseMirrorRows,
  readMirrorSession,
  replaceMirrorRows,
  writeMirrorSession,
} from "@/lib/offline/core/mirror-cache";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  tasksItemsTable,
  tasksListsTable,
  type OfflineTaskRow,
} from "@/lib/offline/tasks/tasks-schema";

const db = () => offlineDbForAccount(offlineAccountKeyFromUsername("mirror-cache"));

function taskRow(id: string, pendingSync: boolean, title = id): OfflineTaskRow {
  return {
    id,
    taskListId: "list",
    data: JSON.stringify({ id, title }),
    pendingSync,
    updatedAt: 1,
  };
}

describe("mirror cache", () => {
  beforeEach(async () => {
    await db().meta.clear();
    await tasksItemsTable(db()).clear();
    await tasksListsTable(db()).clear();
  });

  it("reads back the session it wrote, and null before one was written", async () => {
    expect(await readMirrorSession(db(), "test:session")).toBeNull();

    await writeMirrorSession(db(), "test:session", { user: "ada" });

    expect(await readMirrorSession(db(), "test:session")).toEqual({ user: "ada" });
  });

  it("parses data rows in row order", () => {
    expect(parseMirrorRows([{ data: '{"id":"b"}' }, { data: '{"id":"a"}' }])).toEqual([
      { id: "b" },
      { id: "a" },
    ]);
  });

  it("replaces the rows and keeps a row with a pending local change", async () => {
    const items = tasksItemsTable(db());
    await items.bulkPut([taskRow("gone", false), taskRow("local", true, "my edit")]);

    await replaceMirrorRows(items, [taskRow("server", false), taskRow("local", false, "server")]);

    const rows = await items.orderBy("id").toArray();
    expect(rows.map((row) => [row.id, row.pendingSync, JSON.parse(row.data).title])).toEqual([
      ["local", true, "my edit"],
      ["server", false, "server"],
    ]);
  });

  it("clears every row of a table without pending rows", async () => {
    const lists = tasksListsTable(db());
    await lists.bulkPut([
      { id: "old", data: "{}" },
      { id: "kept-by-server", data: "{}" },
    ]);

    await replaceMirrorRows(lists, [{ id: "kept-by-server", data: '{"v":2}' }]);

    expect(await lists.toArray()).toEqual([{ id: "kept-by-server", data: '{"v":2}' }]);
  });

  it("keeps the rows a custom rule names and writes them back as restore answers", async () => {
    const items = tasksItemsTable(db());
    await items.bulkPut([taskRow("newer", false), taskRow("older", false)]);

    await replaceMirrorRows(items, [], {
      keep: (row) => row.id === "newer",
      restore: (row) => ({ ...row, data: '{"restored":true}' }),
    });

    expect(await items.toArray()).toEqual([
      { ...taskRow("newer", false), data: '{"restored":true}' },
    ]);
  });

  it("runs inside the caller's transaction", async () => {
    const items = tasksItemsTable(db());
    await items.put(taskRow("before", false));

    await expect(
      db().transaction("rw", items, async () => {
        await replaceMirrorRows(items, [taskRow("after", false)]);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect((await items.toArray()).map((row) => row.id)).toEqual(["before"]);
  });
});
