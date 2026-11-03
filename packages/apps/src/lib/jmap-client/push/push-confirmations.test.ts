import { describe, expect, it } from "vitest";
import { PushConfirmations } from "./push-confirmations";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);

describe("PushConfirmations", () => {
  it("sends no id before the server sent one", () => {
    expect(new PushConfirmations().lastEventId(null)).toBeNull();
  });

  it("counts a type no tab subscribes to as confirmed", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: A, FileNode: B });
    expect(store.lastEventId(null)).toBe(`v1;FileNode=${B};Note=${A}`);
  });

  it("keeps the old hash until every subscribed tab confirmed the new one", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: A });
    store.setTab("t1", { types: ["Note"], confirmed: { Note: A } });
    store.setTab("t2", { types: ["Note"], confirmed: { Note: A } });
    expect(store.lastEventId(null)).toBe(`v1;Note=${A}`);

    store.noteLatest({ Note: B });
    store.setTab("t1", { types: ["Note"], confirmed: { Note: B } });
    // t2 still at A: the tabs disagree, so leave Note out and the server re-sends it.
    expect(store.lastEventId(null)).toBeNull();

    store.setTab("t2", { types: ["Note"], confirmed: { Note: B } });
    expect(store.lastEventId(null)).toBe(`v1;Note=${B}`);
  });

  it("sends no id while a live tab has no entry", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: A });
    store.setTab("t1", { types: ["Note"], confirmed: { Note: A } });
    expect(store.lastEventId(new Set(["t1"]))).toBe(`v1;Note=${A}`);
    expect(store.lastEventId(new Set(["t1", "t2"]))).toBeNull();
  });

  it("forgets other tabs on keepOnly", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: A });
    store.setTab("t1", { types: ["Note"], confirmed: {} });
    store.setTab("t2", { types: ["Chat"], confirmed: {} });
    store.keepOnly("t2");
    expect(store.lastEventId(new Set(["t2"]))).toBe(`v1;Note=${A}`);
  });

  it("leaves out a subscribed type that no sync confirmed yet", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: A, Calendar: C });
    store.setTab("t1", { types: ["Note"], confirmed: {} });
    expect(store.lastEventId(null)).toBe(`v1;Calendar=${C}`);
  });

  it("ignores tabs that are gone, by bye or by the live set", () => {
    const store = new PushConfirmations();
    store.noteLatest({ Note: B });
    store.setTab("t1", { types: ["Note"], confirmed: { Note: B } });
    store.setTab("dead", { types: ["Note"], confirmed: { Note: A } });
    expect(store.lastEventId(new Set(["t1"]))).toBe(`v1;Note=${B}`);

    store.removeTab("dead");
    expect(store.lastEventId(null)).toBe(`v1;Note=${B}`);
  });

  it("uses a tab's confirmed hash for a type it never saw as latest", () => {
    const store = new PushConfirmations();
    store.setTab("t1", { types: ["Note"], confirmed: { Note: A } });
    expect(store.lastEventId(null)).toBe(`v1;Note=${A}`);
  });
});
