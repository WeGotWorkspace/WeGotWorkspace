/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";

vi.mock("@/lib/api/wgw/notifications", () => ({ ackLocalNotification: vi.fn() }));

import { ackLocalNotification } from "@/lib/api/wgw/notifications";
import { createLocalAckClaims } from "@/notifications-core/src/local-ack-claims";
import { useNotificationsLocalAck } from "@/notifications-core/src/use-notifications-local-ack";

const row = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "t",
  body: null,
  navigate: "/meet",
  tag: null,
  readAt: null,
  createdAt: "2026-10-29T12:00:00Z",
};

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

function twoTabs() {
  const locks = new FakeWebLocks();
  const a = renderHook(() =>
    useNotificationsLocalAck(() => createLocalAckClaims(locks.client("a"))),
  );
  const c = renderHook(() =>
    useNotificationsLocalAck(() => createLocalAckClaims(locks.client("c"))),
  );
  return { locks, a, c };
}

describe("useNotificationsLocalAck across tabs", () => {
  beforeEach(() => {
    vi.mocked(ackLocalNotification).mockReset();
    vi.mocked(ackLocalNotification).mockResolvedValue(undefined);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(cleanup);

  it("two visible tabs that see the same row ack it once", async () => {
    const { a, c } = twoTabs();
    a.result.current([row]);
    c.result.current([row]);
    await settle();
    a.result.current([row]);
    c.result.current([row]);
    await settle();
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
  });

  it("a failed ack frees the row for the other tab", async () => {
    vi.mocked(ackLocalNotification).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { a, c } = twoTabs();
    a.result.current([row]);
    await settle();
    c.result.current([row]);
    await settle();
    expect(ackLocalNotification).toHaveBeenCalledTimes(2);
  });

  it("the tab that holds the row hands it over when it closes", async () => {
    const { a, c } = twoTabs();
    a.result.current([row]);
    await settle();
    c.result.current([row]);
    await settle();
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
    a.unmount();
    await settle();
    c.result.current([row]);
    await settle();
    // The server ack is idempotent; the other tab acks again only once the first is gone.
    expect(ackLocalNotification).toHaveBeenCalledTimes(2);
  });
});
