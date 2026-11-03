import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/notifications", () => ({
  fetchVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwCurrentAccessToken: vi.fn(() => null),
}));

import { wgwCurrentAccessToken } from "@/lib/api/wgw/http";
import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api/wgw/notifications";
import {
  ensurePushPermissionAndSubscribe,
  resetEnsurePushSubscriptionForTests,
  shouldRequestNotificationPermission,
} from "./ensure-push-subscription";

const subscribe = vi.fn();
const getSubscription = vi.fn();
const CURRENT_KEY = [1, 2, 3]; // "AQID", the stubbed VAPID public key
const SUBSCRIBER_KEY = "wgw.push.subscriber";

function signInAs(username: string): void {
  const payload = btoa(JSON.stringify({ sub: username }));
  vi.mocked(wgwCurrentAccessToken).mockReturnValue(`header.${payload}.signature`);
}

function storedSubscription(applicationServerKey: number[] | null) {
  return {
    endpoint: "https://push.example/old",
    options: {
      applicationServerKey: applicationServerKey
        ? new Uint8Array(applicationServerKey).buffer
        : null,
    },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint: "https://push.example/old", keys: { p256dh: "x", auth: "y" } }),
  };
}

function stubNotification(permission: NotificationPermission): ReturnType<typeof vi.fn> {
  const requestPermission = vi.fn(async () => permission);
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: class {
      static permission = permission;
      static requestPermission = requestPermission;
    },
  });
  return requestPermission;
}

describe("ensurePushPermissionAndSubscribe", () => {
  beforeEach(() => {
    resetEnsurePushSubscriptionForTests();
    window.localStorage.removeItem(SUBSCRIBER_KEY);
    vi.mocked(wgwCurrentAccessToken).mockReturnValue(null);
    vi.mocked(fetchVapidPublicKey).mockReset();
    vi.mocked(subscribePush).mockReset();
    vi.mocked(unsubscribePush).mockReset();
    subscribe.mockReset();
    getSubscription.mockReset();
    vi.mocked(fetchVapidPublicKey).mockResolvedValue("AQID");
    vi.mocked(subscribePush).mockResolvedValue(undefined);
    vi.mocked(unsubscribePush).mockResolvedValue(undefined);
    subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }),
    });
    getSubscription.mockResolvedValue(null);
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      writable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { subscribe, getSubscription },
        }),
      },
    });
  });

  afterEach(() => {
    resetEnsurePushSubscriptionForTests();
  });

  it("only auto-prompts while permission is still default", () => {
    expect(shouldRequestNotificationPermission("default")).toBe(true);
    expect(shouldRequestNotificationPermission("granted")).toBe(false);
    expect(shouldRequestNotificationPermission("denied")).toBe(false);
  });

  it("requests permission once and subscribes when the user allows alerts", async () => {
    const requestPermission = stubNotification("default");
    requestPermission.mockResolvedValue("granted");

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);
    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalled();
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: "https://push.example/1",
      keys: { p256dh: "a", auth: "b" },
    });
  });

  it("does not prompt again when the browser already denied", async () => {
    const requestPermission = stubNotification("denied");

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("subscribes without prompting when permission is already granted", async () => {
    const requestPermission = stubNotification("granted");

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("posts an existing PushSubscription when subscribe() would throw", async () => {
    stubNotification("granted");
    getSubscription.mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://web.push.apple.com/safari",
        keys: { p256dh: "a", auth: "b" },
      }),
    });
    subscribe.mockRejectedValue(new Error("already subscribed"));

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: "https://web.push.apple.com/safari",
      keys: { p256dh: "a", auth: "b" },
    });
  });

  it("returns false when PushManager subscribe fails and nothing is stored", async () => {
    stubNotification("granted");
    subscribe.mockRejectedValue(new Error("AbortError"));

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);

    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with another VAPID key", async () => {
    stubNotification("granted");
    const stale = storedSubscription([9, 9, 9]);
    getSubscription.mockResolvedValue(stale);

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(unsubscribePush).toHaveBeenCalledWith("https://push.example/old");
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(subscribe.mock.calls[0][0].applicationServerKey)).toEqual(
      new Uint8Array(CURRENT_KEY),
    );
    expect(subscribePush).toHaveBeenCalledTimes(1);
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: "https://push.example/1",
      keys: { p256dh: "a", auth: "b" },
    });
    expect(vi.mocked(unsubscribePush).mock.invocationCallOrder[0]).toBeLessThan(
      stale.unsubscribe.mock.invocationCallOrder[0],
    );
    expect(stale.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      subscribe.mock.invocationCallOrder[0],
    );
  });

  it("treats a key of another length as a different VAPID key", async () => {
    stubNotification("granted");
    const stale = storedSubscription([1, 2, 3, 4]);
    getSubscription.mockResolvedValue(stale);

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(unsubscribePush).toHaveBeenCalledWith("https://push.example/old");
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps a subscription made with the current VAPID key", async () => {
    stubNotification("granted");
    const current = storedSubscription(CURRENT_KEY);
    getSubscription.mockResolvedValue(current);

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(unsubscribePush).not.toHaveBeenCalled();
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: "https://push.example/old",
      keys: { p256dh: "x", auth: "y" },
    });
  });

  it("keeps a subscription whose VAPID key the browser does not expose", async () => {
    stubNotification("granted");
    const unknown = storedSubscription(null);
    getSubscription.mockResolvedValue(unknown);

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(unsubscribePush).not.toHaveBeenCalled();
    expect(unknown.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("keeps the stale subscription for a retry when the server DELETE fails", async () => {
    stubNotification("granted");
    const stale = storedSubscription([9, 9, 9]);
    getSubscription.mockResolvedValue(stale);
    vi.mocked(unsubscribePush).mockRejectedValue(
      new Error("DELETE push subscription failed (503)"),
    );

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);

    expect(stale.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("runs one replacement when several subscribe runs start at once", async () => {
    stubNotification("granted");
    const stale = storedSubscription([9, 9, 9]);
    const fresh = {
      endpoint: "https://push.example/1",
      options: { applicationServerKey: new Uint8Array(CURRENT_KEY).buffer },
      unsubscribe: vi.fn(async () => true),
      toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }),
    };
    let current: typeof stale | typeof fresh | null = stale;
    getSubscription.mockImplementation(async () => current);
    stale.unsubscribe.mockImplementation(async () => {
      current = null;
      return true;
    });
    subscribe.mockImplementation(async () => {
      current = fresh;
      return fresh;
    });

    const runs = await Promise.all([
      ensurePushPermissionAndSubscribe(),
      ensurePushPermissionAndSubscribe(),
      ensurePushPermissionAndSubscribe(),
    ]);

    expect(runs).toEqual([true, true, true]);
    expect(unsubscribePush).toHaveBeenCalledTimes(1);
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(fresh.unsubscribe).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(subscribePush)
        .mock.calls.every(([sub]) => sub.endpoint === "https://push.example/1"),
    ).toBe(true);
  });

  it("lets a later subscribe run after one hangs past the limit", async () => {
    vi.useFakeTimers();
    try {
      stubNotification("granted");
      subscribe.mockReturnValueOnce(new Promise(() => undefined));

      const first = ensurePushPermissionAndSubscribe();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(first).resolves.toBe(false);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(subscribe).toHaveBeenCalledTimes(2);
      expect(subscribePush).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not post from a timed-out run once a newer run has started", async () => {
    vi.useFakeTimers();
    try {
      stubNotification("granted");
      let settleFirst: (value: unknown) => void = () => undefined;
      let settleSecond: (value: unknown) => void = () => undefined;
      subscribe
        .mockReturnValueOnce(new Promise((resolve) => (settleFirst = resolve)))
        .mockReturnValueOnce(new Promise((resolve) => (settleSecond = resolve)));
      const subscriptionOf = (endpoint: string) => ({
        toJSON: () => ({ endpoint, keys: { p256dh: "a", auth: "b" } }),
      });

      const first = ensurePushPermissionAndSubscribe();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(first).resolves.toBe(false);

      const second = ensurePushPermissionAndSubscribe();
      await vi.advanceTimersByTimeAsync(0);
      expect(subscribe).toHaveBeenCalledTimes(2);

      settleFirst(subscriptionOf("https://push.example/first"));
      await vi.advanceTimersByTimeAsync(0);
      expect(subscribePush).not.toHaveBeenCalled();

      settleSecond(subscriptionOf("https://push.example/second"));
      await expect(second).resolves.toBe(true);
      expect(subscribePush).toHaveBeenCalledTimes(1);
      expect(subscribePush).toHaveBeenCalledWith({
        endpoint: "https://push.example/second",
        keys: { p256dh: "a", auth: "b" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not unsubscribe from a timed-out run once a newer run replaced the subscription", async () => {
    vi.useFakeTimers();
    try {
      stubNotification("granted");
      const stale = storedSubscription([9, 9, 9]);
      getSubscription.mockResolvedValue(stale);
      let settleDelete: () => void = () => undefined;
      vi.mocked(unsubscribePush).mockReturnValueOnce(
        new Promise<void>((resolve) => (settleDelete = resolve)),
      );

      const first = ensurePushPermissionAndSubscribe();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(first).resolves.toBe(false);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);
      expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(1);

      settleDelete();
      await vi.advanceTimersByTimeAsync(0);

      expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribePush).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still runs later subscribes after one fails", async () => {
    stubNotification("granted");
    subscribe.mockRejectedValueOnce(new Error("NotAllowedError"));

    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);
    await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

    expect(subscribePush).toHaveBeenCalledTimes(1);
  });

  describe("on a browser another account used before", () => {
    it("replaces the subscription another account posted", async () => {
      stubNotification("granted");
      window.localStorage.setItem(SUBSCRIBER_KEY, "alice");
      signInAs("bob");
      const previous = storedSubscription(CURRENT_KEY);
      getSubscription.mockResolvedValue(previous);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
      expect(unsubscribePush).not.toHaveBeenCalled();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribePush).toHaveBeenCalledWith({
        endpoint: "https://push.example/1",
        keys: { p256dh: "a", auth: "b" },
      });
      expect(window.localStorage.getItem(SUBSCRIBER_KEY)).toBe("bob");
    });

    it("keeps the subscription when the same account signs in again", async () => {
      stubNotification("granted");
      window.localStorage.setItem(SUBSCRIBER_KEY, "alice");
      signInAs("alice");
      const previous = storedSubscription(CURRENT_KEY);
      getSubscription.mockResolvedValue(previous);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(previous.unsubscribe).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      expect(subscribePush).toHaveBeenCalledWith({
        endpoint: "https://push.example/old",
        keys: { p256dh: "x", auth: "y" },
      });
    });

    it("treats a username that differs only in case as the same account", async () => {
      stubNotification("granted");
      window.localStorage.setItem(SUBSCRIBER_KEY, "Alice");
      signInAs("alice");
      const previous = storedSubscription(CURRENT_KEY);
      getSubscription.mockResolvedValue(previous);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(previous.unsubscribe).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
    });

    it("keeps a subscription with no recorded account and records the signed-in one", async () => {
      stubNotification("granted");
      signInAs("bob");
      const previous = storedSubscription(CURRENT_KEY);
      getSubscription.mockResolvedValue(previous);

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(previous.unsubscribe).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(SUBSCRIBER_KEY)).toBe("bob");
    });

    it("keeps the previous record when the server does not store the subscription", async () => {
      stubNotification("granted");
      window.localStorage.setItem(SUBSCRIBER_KEY, "alice");
      signInAs("bob");
      vi.mocked(subscribePush).mockRejectedValue(new Error("POST push subscription failed (503)"));

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);

      expect(window.localStorage.getItem(SUBSCRIBER_KEY)).toBe("alice");
    });

    it("subscribes once after the previous account's subscription was dropped", async () => {
      stubNotification("granted");
      window.localStorage.setItem(SUBSCRIBER_KEY, "alice");
      signInAs("bob");
      const previous = storedSubscription(CURRENT_KEY);
      getSubscription.mockResolvedValueOnce(previous).mockResolvedValue(null);
      subscribe.mockRejectedValueOnce(new Error("NotAllowedError"));

      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(false);
      await expect(ensurePushPermissionAndSubscribe()).resolves.toBe(true);

      expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(2);
      expect(subscribePush).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(SUBSCRIBER_KEY)).toBe("bob");
    });
  });
});
