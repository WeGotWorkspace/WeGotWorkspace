import { describe, expect, it } from "vitest";
import type { NotificationInboxItem } from "./notifications-types";
import {
  dropPushedItems,
  holdPushedItem,
  mergePushedItems,
  PUSHED_ITEM_HOLD_MS,
} from "./pushed-inbox-items";

function row(id: string): NotificationInboxItem {
  return {
    id,
    domain: "meet",
    action: "started",
    data: null,
    title: `Row ${id}`,
    body: null,
    navigate: "/meet",
    tag: null,
    readAt: null,
    createdAt: null,
  };
}

describe("mergePushedItems", () => {
  it("puts a held row in front of a list that does not carry it yet", () => {
    const pending = holdPushedItem(new Map(), row("pushed"), 1_000);
    const merged = mergePushedItems({ list: [row("old")], unreadCount: 1 }, pending, 2_000);
    expect(merged.payload.list.map((item) => item.id)).toEqual(["pushed", "old"]);
    expect(merged.payload.unreadCount).toBe(2);
    expect(merged.pending.size).toBe(1);
  });

  it("a list that carries the row confirms it: shown once, no longer held", () => {
    const pending = holdPushedItem(new Map(), row("pushed"), 1_000);
    const merged = mergePushedItems(
      { list: [row("pushed"), row("old")], unreadCount: 2 },
      pending,
      2_000,
    );
    expect(merged.payload.list.map((item) => item.id)).toEqual(["pushed", "old"]);
    expect(merged.payload.unreadCount).toBe(2);
    expect(merged.pending.size).toBe(0);
  });

  it("drops a row held longer than the hold: the server list wins", () => {
    const pending = holdPushedItem(new Map(), row("pushed"), 1_000);
    const merged = mergePushedItems(
      { list: [], unreadCount: 0 },
      pending,
      1_000 + PUSHED_ITEM_HOLD_MS,
    );
    expect(merged.payload.list).toEqual([]);
    expect(merged.pending.size).toBe(0);
  });

  it("a row read in the meantime is no longer merged", () => {
    const pending = dropPushedItems(holdPushedItem(new Map(), row("pushed"), 1_000), ["pushed"]);
    expect(mergePushedItems({ list: [], unreadCount: 0 }, pending, 2_000).payload.list).toEqual([]);
  });
});
