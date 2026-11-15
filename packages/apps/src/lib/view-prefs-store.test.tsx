import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

type TestPrefs = {
  mode?: "a" | "b";
  hiddenIds?: string[];
  knownIds?: string[];
  folded?: boolean;
};

const KEY = "wgw.ui.test.viewPrefs";

function makeStore() {
  return createViewPrefsStore<TestPrefs>(KEY, {
    mode: viewPrefsField.oneOf(["a", "b"]),
    hiddenIds: viewPrefsField.idList,
    knownIds: viewPrefsField.idList,
    folded: viewPrefsField.boolean,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("createViewPrefsStore parse", () => {
  const store = makeStore();

  it("keeps valid fields and drops unknown or invalid values", () => {
    expect(
      store.parse(
        JSON.stringify({
          mode: "c",
          hiddenIds: ["work", 2, "", "family"],
          knownIds: "work",
          folded: "yes",
          extra: ["x"],
        }),
      ),
    ).toEqual({ hiddenIds: ["work", "family"] });
    expect(store.parse(JSON.stringify({ mode: "b", folded: false, hiddenIds: [] }))).toEqual({
      mode: "b",
      folded: false,
      hiddenIds: [],
    });
  });

  it("returns null for missing, corrupt, non-object, or empty payloads", () => {
    for (const raw of [null, "", "{", "[]", "null", "3", JSON.stringify({ mode: "A" })]) {
      expect(store.parse(raw)).toBeNull();
    }
  });
});

describe("createViewPrefsStore read / write / patch", () => {
  it("writes the object as JSON under its key and reads it back", () => {
    const store = makeStore();
    store.write({ mode: "a", hiddenIds: ["x"] });
    expect(window.localStorage.getItem(KEY)).toBe('{"mode":"a","hiddenIds":["x"]}');
    expect(store.read()).toEqual({ mode: "a", hiddenIds: ["x"] });
  });

  it("patch merges defined fields and keeps the rest", () => {
    const store = makeStore();
    store.write({ mode: "a", hiddenIds: ["x"], folded: true });
    expect(store.patch({ mode: "b", hiddenIds: undefined })).toEqual({
      mode: "b",
      hiddenIds: ["x"],
      folded: true,
    });
    store.patch({ hiddenIds: [] });
    expect(store.read()).toEqual({ mode: "b", hiddenIds: [], folded: true });
  });

  it("swallows storage failures and no-ops without window", () => {
    const store = makeStore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => store.write({ mode: "a" })).not.toThrow();
    expect(() => store.patch({ mode: "b" })).not.toThrow();
    expect(store.read()).toBeNull();

    vi.stubGlobal("window", undefined);
    expect(() => store.patch({ mode: "a" })).not.toThrow();
    expect(store.read()).toBeNull();
  });
});

describe("createViewPrefsStore subscribe / snapshot", () => {
  it("notifies listeners after each write until unsubscribed", () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.patch({ folded: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.patch({ folded: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns the same reference until the stored JSON changes", () => {
    const store = makeStore();
    const getHidden = store.snapshot((prefs) => prefs?.hiddenIds ?? []);
    const empty = getHidden();
    expect(getHidden()).toBe(empty);
    store.patch({ hiddenIds: ["x"] });
    const first = getHidden();
    expect(first).toEqual(["x"]);
    expect(getHidden()).toBe(first);
    store.patch({ folded: true });
    expect(getHidden()).not.toBe(first);
    expect(getHidden()).toEqual(["x"]);
  });
});

describe("createViewPrefsStore hiddenCollection", () => {
  it("writes the hidden / known pair without touching other fields", () => {
    const store = makeStore();
    store.write({ mode: "a" });
    const hidden = store.hiddenCollection("hiddenIds", "knownIds");
    expect(hidden.read()).toEqual({ hiddenIds: undefined, knownIds: undefined });
    hidden.write(new Set(["work"]), ["default", "work", "", "work"]);
    expect(store.read()).toEqual({
      mode: "a",
      hiddenIds: ["work"],
      knownIds: ["default", "work"],
    });
    expect(hidden.read()).toEqual({ hiddenIds: ["work"], knownIds: ["default", "work"] });
  });

  it("reads null when nothing is stored", () => {
    expect(makeStore().hiddenCollection("hiddenIds", "knownIds").read()).toBeNull();
  });
});
