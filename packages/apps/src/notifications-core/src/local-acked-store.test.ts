import { describe, expect, it } from "vitest";
import { createLocalAckedStore, LOCAL_ACKED_STORAGE_KEY } from "./local-acked-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("createLocalAckedStore", () => {
  it("keeps acked ids across store instances (a reload)", () => {
    const storage = memoryStorage();
    createLocalAckedStore(storage).add(["n1", "n2"]);

    expect([...createLocalAckedStore(storage).read()]).toEqual(["n1", "n2"]);
  });

  it("keeps the newest ids when the cap is reached", () => {
    const storage = memoryStorage();
    const store = createLocalAckedStore(storage, 3);
    store.add(["n1", "n2"]);
    store.add(["n3", "n4"]);

    expect([...store.read()]).toEqual(["n2", "n3", "n4"]);
  });

  it("moves a re-added id to the newest end instead of storing it twice", () => {
    const store = createLocalAckedStore(memoryStorage(), 3);
    store.add(["n1", "n2", "n3"]);
    store.add(["n1", "n4"]);

    expect([...store.read()]).toEqual(["n3", "n1", "n4"]);
  });

  it("treats a corrupt stored value as empty and repairs it on the next add", () => {
    const storage = memoryStorage({ [LOCAL_ACKED_STORAGE_KEY]: "{not json" });
    const store = createLocalAckedStore(storage);
    expect(store.read().size).toBe(0);

    store.add(["n1"]);
    expect(JSON.parse(storage.data.get(LOCAL_ACKED_STORAGE_KEY) ?? "null")).toEqual(["n1"]);
  });

  it("drops non-string entries from a stored list", () => {
    const storage = memoryStorage({
      [LOCAL_ACKED_STORAGE_KEY]: JSON.stringify(["n1", 2, null, ""]),
    });

    expect([...createLocalAckedStore(storage).read()]).toEqual(["n1"]);
  });

  it("falls back to memory when storage throws", () => {
    const store = createLocalAckedStore({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    store.add(["n1"]);

    expect(store.read().has("n1")).toBe(true);
  });

  it("works without storage at all", () => {
    const store = createLocalAckedStore(null);
    store.add(["n1"]);

    expect(store.read().has("n1")).toBe(true);
  });
});
