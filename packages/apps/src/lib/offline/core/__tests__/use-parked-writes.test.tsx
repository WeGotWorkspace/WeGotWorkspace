import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { parkWrites, type ParkedWriteInput } from "@/lib/offline/core/parked-writes";
import { useParkedWrites } from "@/lib/offline/core/use-parked-writes";

const username = "parked-hook-user";

function write(entityId: string): ParkedWriteInput<null> {
  return {
    domain: "tasks",
    entityId,
    kind: "create",
    reason: "gone",
    containerId: "list-1",
    containerName: "Groceries",
    title: entityId,
    item: null,
  };
}

/** Web Locks as two tabs see them: one holder per name, `ifAvailable` gives up. */
function installLocks() {
  const held = new Set<string>();
  const locks = {
    request(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown,
    ) {
      if (options.ifAvailable && held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
}

describe("useParkedWrites", () => {
  beforeEach(async () => {
    installLocks();
    await offlineDbForAccount(offlineAccountKeyFromUsername(username)).meta.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("opens the dialog in one tab only, and in the other when the first lets go", async () => {
    await parkWrites(username, "tasks", [write("a")]);
    const first = renderHook(() => useParkedWrites(username, "tasks"));
    await waitFor(() => expect(first.result.current.open).toBe(true));
    const second = renderHook(() => useParkedWrites(username, "tasks"));
    await waitFor(() => expect(second.result.current.writes).toHaveLength(1));

    expect(second.result.current.open).toBe(false);
    expect(await act(() => second.result.current.openDialog())).toBe(false);

    act(() => first.result.current.closeDialog());
    await act(async () => {
      await Promise.resolve();
    });
    expect(await act(() => second.result.current.openDialog())).toBe(true);
    expect(second.result.current.open).toBe(true);
  });

  it("stays closed after Later until a new write is parked", async () => {
    await parkWrites(username, "tasks", [write("a")]);
    const { result } = renderHook(() => useParkedWrites(username, "tasks"));
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.closeDialog());
    await act(() => parkWrites(username, "tasks", [write("a")]));
    expect(result.current.open).toBe(false);
    expect(result.current.writes).toHaveLength(1);

    await act(() => parkWrites(username, "tasks", [write("b")]));
    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it("closes when every write is taken", async () => {
    await parkWrites(username, "tasks", [write("a")]);
    const { result } = renderHook(() => useParkedWrites(username, "tasks"));
    await waitFor(() => expect(result.current.open).toBe(true));

    const taken = await act(() => result.current.take(["tasks:a"]));

    expect(taken.map((row) => row.id)).toEqual(["tasks:a"]);
    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.writes).toEqual([]);
  });
});
