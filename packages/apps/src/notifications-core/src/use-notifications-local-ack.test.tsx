/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";

vi.mock("@/lib/api/wgw/notifications", () => ({ ackLocalNotifications: vi.fn() }));

import { ackLocalNotifications } from "@/lib/api/wgw/notifications";
import { browserLocalAckedStore } from "@/notifications-core/src/local-acked-store";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import {
  type LocalAckDeps,
  useNotificationsLocalAck,
} from "@/notifications-core/src/use-notifications-local-ack";

function row(id: string): NotificationInboxItem {
  return {
    id,
    domain: "tasks",
    action: "shared",
    title: "t",
    body: null,
    navigate: "/tasks",
    tag: null,
    readAt: null,
    createdAt: "2026-10-29T12:00:00Z",
  };
}

function rows(count: number, prefix = "n"): NotificationInboxItem[] {
  return Array.from({ length: count }, (_, index) => row(`${prefix}${index + 1}`));
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

const sentIds = () => vi.mocked(ackLocalNotifications).mock.calls.map(([ids]) => [...ids]);

/** One tab of a browser: its own Web Locks client, the browser's shared localStorage. */
function tabDeps(locks: FakeWebLocks, tab: string): () => LocalAckDeps {
  const client = locks.client(tab);
  return () => ({
    runExclusive: (task) =>
      client.request("wgw-notifications/local-ack", { mode: "exclusive" }, () =>
        task(),
      ) as Promise<void>,
    acked: browserLocalAckedStore(),
  });
}

function openTab(locks: FakeWebLocks, tab: string) {
  return renderHook(() => useNotificationsLocalAck(tabDeps(locks, tab)));
}

describe("useNotificationsLocalAck", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(ackLocalNotifications).mockReset();
    vi.mocked(ackLocalNotifications).mockResolvedValue(undefined);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(cleanup);

  it("acks 150 unread rows with one request per 100 rows, not one per row", async () => {
    const locks = new FakeWebLocks();
    const tab = openTab(locks, "a");
    const unread = rows(150);

    tab.result.current(unread);
    await settle();

    expect(sentIds().map((ids) => ids.length)).toEqual([100, 50]);
    expect(sentIds().flat()).toEqual(unread.map((item) => item.id));
  });

  it("acks a full inbox page (the 100 rows the API returns) with exactly one request", async () => {
    const tab = openTab(new FakeWebLocks(), "a");

    tab.result.current(rows(100));
    await settle();

    expect(ackLocalNotifications).toHaveBeenCalledTimes(1);
  });

  it("sends nothing after a reload when the unread rows are the same", async () => {
    const locks = new FakeWebLocks();
    const first = openTab(locks, "a");
    first.result.current(rows(100));
    await settle();
    first.unmount();
    vi.mocked(ackLocalNotifications).mockClear();

    const reloaded = openTab(locks, "a2");
    reloaded.result.current(rows(100));
    await settle();
    reloaded.result.current(rows(100));
    await settle();

    expect(ackLocalNotifications).not.toHaveBeenCalled();
  });

  it("acks only the new row when one arrives", async () => {
    const tab = openTab(new FakeWebLocks(), "a");
    const unread = rows(100);
    tab.result.current(unread);
    await settle();
    vi.mocked(ackLocalNotifications).mockClear();

    tab.result.current([row("fresh"), ...unread.slice(0, 99)]);
    await settle();

    expect(sentIds()).toEqual([["fresh"]]);
  });

  it("acks rows that arrive during a request in one follow-up request", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(ackLocalNotifications).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const tab = openTab(new FakeWebLocks(), "a");
    tab.result.current([row("n1")]);
    await settle();
    tab.result.current([row("n2"), row("n1")]);
    tab.result.current([row("n3"), row("n2"), row("n1")]);
    await settle();
    expect(ackLocalNotifications).toHaveBeenCalledTimes(1);

    finish();
    await settle();

    expect(sentIds()).toEqual([["n1"], ["n3", "n2"]]);
  });

  it("does not ack from a hidden window", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const tab = openTab(new FakeWebLocks(), "a");

    tab.result.current(rows(3));
    await settle();

    expect(ackLocalNotifications).not.toHaveBeenCalled();
  });

  it("retries a failed batch on the next list and remembers nothing from it", async () => {
    vi.mocked(ackLocalNotifications).mockRejectedValueOnce(new Error("429"));
    const tab = openTab(new FakeWebLocks(), "a");
    tab.result.current(rows(2));
    await settle();
    expect(browserLocalAckedStore().read().size).toBe(0);

    tab.result.current(rows(2));
    await settle();

    expect(sentIds()).toEqual([
      ["n1", "n2"],
      ["n1", "n2"],
    ]);
    expect(browserLocalAckedStore().read().size).toBe(2);
  });

  it("two visible tabs that see the same rows send them once", async () => {
    const locks = new FakeWebLocks();
    const a = openTab(locks, "a");
    const c = openTab(locks, "c");
    a.result.current(rows(100));
    c.result.current(rows(100));
    await settle();
    a.result.current(rows(100));
    c.result.current(rows(100));
    await settle();

    expect(ackLocalNotifications).toHaveBeenCalledTimes(1);
  });

  it("a tab that takes over after another tab acked rows 1–10 sends only row 11 (#1834)", async () => {
    const locks = new FakeWebLocks();
    const a = openTab(locks, "a");
    // B is open but has not acked anything yet, as a tab that never held the stream.
    const b = openTab(locks, "b");
    const older = rows(10);
    a.result.current(older);
    await settle();
    expect(sentIds()).toEqual([older.map((item) => item.id)]);
    a.unmount();
    vi.mocked(ackLocalNotifications).mockClear();

    b.result.current([row("n11"), ...older]);
    await settle();

    expect(sentIds()).toEqual([["n11"]]);
  });

  it("a row no tab acked while every tab was hidden is acked by the next visible tab", async () => {
    const locks = new FakeWebLocks();
    const a = openTab(locks, "a");
    const b = openTab(locks, "b");
    const older = rows(10);
    a.result.current(older);
    await settle();
    vi.mocked(ackLocalNotifications).mockClear();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    a.result.current([row("n11"), ...older]);
    b.result.current([row("n11"), ...older]);
    await settle();
    expect(ackLocalNotifications).not.toHaveBeenCalled();
    a.unmount();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(sentIds()).toEqual([["n11"]]);
  });

  it("a failed batch in one tab leaves the rows for the other tab", async () => {
    vi.mocked(ackLocalNotifications).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const locks = new FakeWebLocks();
    const a = openTab(locks, "a");
    const c = openTab(locks, "c");
    a.result.current([row("n1")]);
    await settle();

    c.result.current([row("n1")]);
    await settle();

    expect(ackLocalNotifications).toHaveBeenCalledTimes(2);
  });
});
