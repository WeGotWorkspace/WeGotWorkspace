import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  listParkedWrites,
  parkWrites,
  takeParkedWrites,
  type ParkedWrite,
} from "@/lib/offline/core/parked-writes";
import {
  groupParkedWrites,
  RescueError,
  rescueParkedWrites,
} from "@/lib/offline/core/rescue-parked-writes";

const username = "rescue-core-user";
const domain = "notes";
type Note = { title: string };

function parked(
  entityId: string,
  containerName: string,
  parkedAt: number,
  reason: ParkedWrite["reason"] = "gone",
): ParkedWrite<Note> {
  return {
    id: `${domain}:${entityId}`,
    domain,
    entityId,
    kind: "create",
    reason,
    containerId: `book-${containerName}`,
    containerName,
    title: entityId,
    item: { title: entityId },
    parkedAt,
  };
}

async function parkTwo(): Promise<ParkedWrite<Note>[]> {
  await parkWrites(username, domain, [parked("a", "Ideas", 1), parked("b", "Ideas", 2)]);
  const rows = await listParkedWrites<Note>(username, domain);
  return takeParkedWrites(
    username,
    domain,
    rows.map((row) => row.id),
  );
}

describe("groupParkedWrites", () => {
  it("groups per container in first-refused order, the newest refusal giving the reason", () => {
    const groups = groupParkedWrites([
      parked("c", "Journal", 3),
      parked("a", "Ideas", 1, "readOnly"),
      parked("b", "Journal", 2),
      parked("d", "Ideas", 4, "gone"),
    ]);

    expect(groups.map((group) => [group.containerName, group.reason])).toEqual([
      ["Ideas", "gone"],
      ["Journal", "gone"],
    ]);
    expect(groups[0]!.writes.map((write) => write.entityId)).toEqual(["a", "d"]);
  });
});

describe("rescueParkedWrites", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  it("makes the new container, then creates each item in it", async () => {
    const createContainer = vi.fn(async (_name: string) => ({ id: "fresh" }));
    const createItemIn = vi.fn(async () => undefined);
    const settled = vi.fn(async () => undefined);
    const writes = await parkTwo();

    const result = await rescueParkedWrites(
      username,
      domain,
      writes,
      { newContainerName: "Ideas" },
      { createContainer, createItemIn },
      settled,
    );

    expect(result).toEqual({ containerId: "fresh" });
    expect(createContainer).toHaveBeenCalledWith("Ideas");
    expect(createItemIn.mock.calls).toEqual([
      ["fresh", { title: "a" }],
      ["fresh", { title: "b" }],
    ]);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("parks an item again when it could not be created", async () => {
    const createItemIn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    const writes = await parkTwo();

    await expect(
      rescueParkedWrites(username, domain, writes, { containerId: "keep" }, { createItemIn }),
    ).rejects.toBeInstanceOf(RescueError);

    const left = await listParkedWrites<Note>(username, domain);
    expect(left.map((write) => write.entityId)).toEqual(["b"]);
  });

  it("parks every item again when the new container cannot be made", async () => {
    const createContainer = vi.fn().mockRejectedValue(new Error("offline"));
    const createItemIn = vi.fn();
    const settled = vi.fn(async () => undefined);
    const writes = await parkTwo();

    await expect(
      rescueParkedWrites(
        username,
        domain,
        writes,
        { newContainerName: "Ideas" },
        { createContainer, createItemIn },
        settled,
      ),
    ).rejects.toThrow("offline");

    expect(createItemIn).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(2);
    expect(await listParkedWrites(username, domain)).toHaveLength(2);
  });
});
