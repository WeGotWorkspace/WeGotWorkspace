import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  claimParkedWrites,
  listParkedWrites,
  restoreAbandonedClaims,
  parkWrites,
  subscribeParkedWrites,
  takeParkedWrites,
  type ParkedWriteInput,
} from "@/lib/offline/core/parked-writes";

const username = "parked-user";

function write(entityId: string, title = entityId): ParkedWriteInput<{ title: string }> {
  return {
    domain: "tasks",
    entityId,
    kind: "create",
    reason: "gone",
    containerId: "list-1",
    containerName: "Groceries",
    title,
    item: { title },
  };
}

describe("parked writes", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  it("keeps parked writes per domain, one entry per item", async () => {
    await parkWrites(username, "tasks", [write("a"), write("b")]);
    await parkWrites(username, "tasks", [write("a", "a again")]);
    await parkWrites(username, "notes", [{ ...write("n"), domain: "notes" }]);

    const tasks = await listParkedWrites<{ title: string }>(username, "tasks");
    expect(tasks.map((row) => [row.id, row.title])).toEqual([
      ["tasks:b", "b"],
      ["tasks:a", "a again"],
    ]);
    expect(await listParkedWrites(username, "notes")).toHaveLength(1);
  });

  it("hands a write out once, even when two tabs take it", async () => {
    await parkWrites(username, "tasks", [write("a"), write("b")]);

    const [first, second] = await Promise.all([
      takeParkedWrites(username, "tasks", ["tasks:a"]),
      takeParkedWrites(username, "tasks", ["tasks:a", "tasks:b"]),
    ]);

    expect([...first, ...second].map((row) => row.id).sort()).toEqual(["tasks:a", "tasks:b"]);
    expect(await listParkedWrites(username, "tasks")).toEqual([]);
  });

  it("tells listeners when the parked writes change", async () => {
    const heard: string[] = [];
    const stop = subscribeParkedWrites(username, "tasks", () => heard.push("tasks"));
    await parkWrites(username, "tasks", [write("a")]);
    await parkWrites(username, "notes", [{ ...write("n"), domain: "notes" }]);
    await takeParkedWrites(username, "tasks", ["tasks:a"]);
    stop();

    expect(heard).toEqual(["tasks", "tasks"]);
  });

  it("puts a claimed write back when its tab never settled it", async () => {
    await parkWrites(username, "tasks", [write("a"), write("b")]);
    const claimed = await claimParkedWrites(username, "tasks", ["tasks:a", "tasks:b"]);
    expect(await listParkedWrites(username, "tasks")).toEqual([]);
    await claimed.settle(["tasks:a"]);
    claimed.release();

    await restoreAbandonedClaims(username, "tasks");

    expect((await listParkedWrites(username, "tasks")).map((row) => row.id)).toEqual(["tasks:b"]);
    await restoreAbandonedClaims(username, "tasks");
    expect(await listParkedWrites(username, "tasks")).toHaveLength(1);
  });
});
