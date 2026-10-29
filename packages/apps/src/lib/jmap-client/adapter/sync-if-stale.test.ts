import { describe, expect, it, vi } from "vitest";
import { syncIfStale } from "./sync-if-stale";

function setup(local: Record<string, string>, ok = true) {
  const sync = vi.fn(async () => ok);
  const run = (states: Record<string, string>, pushedAccountId?: string) =>
    syncIfStale({
      getState: (type) => local[type],
      accountId: "alice",
      types: ["Notebook", "Note"],
      states,
      pushedAccountId,
      sync,
    });
  return { sync, run };
}

describe("syncIfStale", () => {
  it("does not sync when every pushed state equals the adapter's own", async () => {
    const { sync, run } = setup({ Notebook: "b1", Note: "n1" });
    await expect(run({ Notebook: "b1", Note: "n1" })).resolves.toBe(true);
    expect(sync).not.toHaveBeenCalled();
  });

  it("syncs once when a pushed state differs and reports the result", async () => {
    const { sync, run } = setup({ Notebook: "b1", Note: "n1" });
    await expect(run({ Note: "n2" })).resolves.toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);

    const failing = setup({ Note: "n1" }, false);
    await expect(failing.run({ Note: "n2" })).resolves.toBe(false);
  });

  it("ignores types it does not own and pushes for another account", async () => {
    const { sync, run } = setup({ Note: "n1" });
    await expect(run({ Calendar: "c9" })).resolves.toBe(true);
    await expect(run({ Note: "n2" }, "bob")).resolves.toBe(true);
    expect(sync).not.toHaveBeenCalled();
  });

  it("does not confirm a type the adapter has no state for yet", async () => {
    const { sync, run } = setup({ Notebook: "b1" });
    await expect(run({ Note: "n1" })).resolves.toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it("reports a thrown sync as failed", async () => {
    const sync = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      syncIfStale({
        getState: () => "old",
        accountId: "alice",
        types: ["Note"],
        states: { Note: "new" },
        sync,
      }),
    ).resolves.toBe(false);
  });
});
