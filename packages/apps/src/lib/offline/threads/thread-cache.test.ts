import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { readThreadCache, writeThreadCache } from "@/lib/offline/threads/thread-cache";

describe("thread cache", () => {
  it("keeps the last thread per subject and account", async () => {
    const subject = { type: "task", id: "t1" };
    expect(await readThreadCache("alice", subject)).toBeNull();
    await writeThreadCache("alice", subject, {
      entries: [],
      state: "3",
      canPost: false,
      fetchedAt: 42,
    });
    expect(await readThreadCache("alice", subject)).toEqual({
      entries: [],
      state: "3",
      canPost: false,
      fetchedAt: 42,
    });
    expect(await readThreadCache("alice", { type: "task", id: "t2" })).toBeNull();
    expect(await readThreadCache("bob", subject)).toBeNull();
  });
});
