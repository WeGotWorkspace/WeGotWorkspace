import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCreate } from "@wgw/openapi-types/tasks-types";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listParkedWrites, takeParkedWrites } from "@/lib/offline/core/parked-writes";
import { rescueParkedWrites } from "@/lib/offline/core/rescue-parked-writes";
import { ApiError } from "@/lib/api/api-error";
import {
  parkTask,
  rescueParticipants,
  tasksRescueOperations,
  type ParkedTask,
} from "@/lib/offline/tasks/tasks-parked-writes";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";

const username = "rescue-user";
const [first, second] = createTasksAppBootstrap().data.tasks as [
  ParkedTask["item"],
  ParkedTask["item"],
];

async function parkBoth(): Promise<ParkedTask[]> {
  await parkTask(
    username,
    { ...first, uid: "uid-1" },
    { kind: "create", reason: "gone", containerName: "Old" },
  );
  await parkTask(username, second, { kind: "edit", reason: "readOnly", containerName: "Old" });
  const writes = await listParkedWrites<ParkedTask["item"]>(username, TASKS_DOMAIN);
  return takeParkedWrites(
    username,
    TASKS_DOMAIN,
    writes.map((write) => write.id),
  );
}

describe("tasksRescueOperations", () => {
  beforeEach(async () => {
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  it("creates each task anew in an existing list, without its old uid", async () => {
    const createTask = vi.fn(async (_body: TaskCreate) => first);
    const writes = await parkBoth();

    const result = await rescueParkedWrites(
      username,
      TASKS_DOMAIN,
      writes,
      { containerId: "keep" },
      tasksRescueOperations({ createTask }),
    );

    expect(result).toEqual({ containerId: "keep" });
    expect(createTask.mock.calls.map(([body]) => body)).toEqual([
      expect.objectContaining({ title: first.title, taskListIds: { keep: true } }),
      expect.objectContaining({ title: second.title, taskListIds: { keep: true } }),
    ]);
    expect(createTask.mock.calls[0]![0]).not.toHaveProperty("uid");
    expect(await listParkedWrites(username, TASKS_DOMAIN)).toEqual([]);
  });

  it("makes the new list first", async () => {
    const createTaskList = vi.fn(async () => ({ id: "fresh", name: "Rescued" }) as never);
    const createTask = vi.fn(async () => first);
    const writes = await parkBoth();

    const result = await rescueParkedWrites(
      username,
      TASKS_DOMAIN,
      writes,
      { newContainerName: "Rescued" },
      tasksRescueOperations({ createTask, createTaskList }),
    );

    expect(createTaskList).toHaveBeenCalledWith({ name: "Rescued" });
    expect(result).toEqual({ containerId: "fresh" });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskListIds: { fresh: true } }),
    );
  });

  it("cannot make a list without createTaskList, and parks every task again", async () => {
    const createTask = vi.fn();
    const writes = await parkBoth();

    await expect(
      rescueParkedWrites(
        username,
        TASKS_DOMAIN,
        writes,
        { newContainerName: "Rescued" },
        tasksRescueOperations({ createTask }),
      ),
    ).rejects.toThrow();

    expect(createTask).not.toHaveBeenCalled();
    expect(await listParkedWrites(username, TASKS_DOMAIN)).toHaveLength(2);
  });

  describe("assignees (#2172)", () => {
    const participants = {
      "u:bob": { "@type": "Participant", name: "Bob" },
      "u:rescue-user": { "@type": "Participant", name: "Me" },
      att1: { "@type": "Participant", name: "Positional" },
      org: { "@type": "Participant", name: "Organizer" },
      "e:outside@example.org": { "@type": "Participant", name: "Outside" },
      "e:carol@example.org": { "@type": "Participant", name: "Carol by mail" },
    } as NonNullable<ParkedTask["item"]["participants"]>;
    const members = [
      { username: "rescue-user", email: null, displayName: "Me", access: "write" },
      { username: "carol", email: "carol@example.org", displayName: "Carol", access: "write" },
      { username: "dave", email: null, displayName: "Dave", access: "read" },
    ] as Parameters<typeof rescueParticipants>[1];

    it("keeps write members and outside addresses, drops the rest", () => {
      expect(Object.keys(rescueParticipants(participants, members, username) ?? {})).toEqual([
        "u:rescue-user",
        "e:outside@example.org",
      ]);
    });

    it("keeps only the own u: entry and addresses when no audience is cached", () => {
      expect(Object.keys(rescueParticipants(participants, null, username) ?? {})).toEqual([
        "u:rescue-user",
        "e:outside@example.org",
        "e:carol@example.org",
      ]);
    });

    it("rescue drops assignees the target list cannot hold", async () => {
      const createTask = vi.fn(async (_body: TaskCreate) => first);
      const operations = tasksRescueOperations(
        { createTask },
        { username, readCachedMembers: async () => [] },
      );
      await operations.createItemIn("keep", {
        ...first,
        participants: {
          "u:bob": { "@type": "Participant", name: "Bob" },
          att1: { "@type": "Participant", name: "Positional" },
          "e:outside@example.org": { "@type": "Participant", name: "Outside" },
        } as ParkedTask["item"]["participants"],
      });
      expect(createTask.mock.calls[0]![0].participants).toEqual({
        "e:outside@example.org": { "@type": "Participant", name: "Outside" },
      });
    });

    it("retries once with only the own entry after invalid_participant", async () => {
      const createTask = vi
        .fn(async (_body: TaskCreate) => first)
        .mockRejectedValueOnce(new ApiError("Invalid", 422, "invalid_participant"));
      const operations = tasksRescueOperations(
        { createTask },
        { username, readCachedMembers: async () => null },
      );
      await expect(operations.createItemIn("keep", { ...first, participants })).resolves.toBe(
        first,
      );
      expect(createTask).toHaveBeenCalledTimes(2);
      expect(createTask.mock.calls[1]![0].participants).toEqual({
        "u:rescue-user": { "@type": "Participant", name: "Me" },
      });
    });

    it("retries without assignees when the parked task had no own entry", async () => {
      const createTask = vi
        .fn(async (_body: TaskCreate) => first)
        .mockRejectedValueOnce(new ApiError("Invalid", 422, "invalid_participant"));
      const operations = tasksRescueOperations({ createTask }, { username });
      await operations.createItemIn("keep", {
        ...first,
        participants: {
          "e:x@example.org": { "@type": "Participant", name: "X" },
          "e:y@example.org": { "@type": "Participant", name: "Y" },
        } as ParkedTask["item"]["participants"],
      });
      expect(createTask).toHaveBeenCalledTimes(2);
      expect(createTask.mock.calls[1]![0]).not.toHaveProperty("participants");
    });

    it("does not retry other errors", async () => {
      const createTask = vi.fn(async (_body: TaskCreate): Promise<typeof first> => {
        throw new ApiError("Nope", 422, "validation_failed");
      });
      const operations = tasksRescueOperations({ createTask }, { username });
      await expect(operations.createItemIn("keep", { ...first, participants })).rejects.toThrow(
        "Nope",
      );
      expect(createTask).toHaveBeenCalledTimes(1);
    });
  });
});
