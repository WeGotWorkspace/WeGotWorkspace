import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/notifications", () => ({
  fetchVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api/wgw/notifications";
import {
  ensurePushPermissionAndSubscribe,
  resetEnsurePushSubscriptionForTests,
  shouldRequestNotificationPermission,
} from "./ensure-push-subscription";

const subscribe = vi.fn();
const getSubscription = vi.fn();
const CURRENT_KEY = [1, 2, 3]; // "AQID", the stubbed VAPID public key

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
});
