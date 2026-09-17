import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/notifications", () => ({
  fetchVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
}));

import { fetchVapidPublicKey, subscribePush } from "@/lib/api/wgw/notifications";
import {
  ensurePushPermissionAndSubscribe,
  resetEnsurePushSubscriptionForTests,
  shouldRequestNotificationPermission,
} from "./ensure-push-subscription";

const subscribe = vi.fn();
const getSubscription = vi.fn();

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
    subscribe.mockReset();
    getSubscription.mockReset();
    vi.mocked(fetchVapidPublicKey).mockResolvedValue("AQID");
    vi.mocked(subscribePush).mockResolvedValue(undefined);
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
});
