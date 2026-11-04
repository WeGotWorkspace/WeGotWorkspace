import { describe, expect, it } from "vitest";
import type { NotificationInboxItem } from "./notifications-types";
import {
  browserMaySkipPushNotification,
  pushDeliveryPlan,
  pushedItemFromMessage,
  pushEngine,
  WGW_NOTIFICATION_PUSHED_MESSAGE,
} from "./push-delivery";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  firefoxMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15",
};

const item: NotificationInboxItem = {
  id: "01JNOTIFICATION",
  domain: "meet",
  action: "started",
  data: null,
  title: "Alice started a meeting",
  body: "standup",
  navigate: "/meet/meetings/standup",
  tag: "meet.started:standup",
  readAt: null,
  createdAt: "2026-11-03T12:00:00Z",
};

const visible = { id: "visible", visibilityState: "visible" };
const hidden = { id: "hidden", visibilityState: "hidden" };

describe("pushEngine (per-browser rule from the spike)", () => {
  it.each([
    ["chromeMac", "chromium"],
    ["chromeAndroid", "chromium"],
    ["edge", "chromium"],
    ["firefoxMac", "firefox-desktop"],
    ["firefoxAndroid", "other"],
    ["safariMac", "other"],
    ["safariIos", "other"],
    ["chromeIos", "other"],
    ["firefoxIos", "other"],
  ] as const)("%s → %s", (browser, engine) => {
    expect(pushEngine(UA[browser])).toBe(engine);
  });

  it("only Chromium and Firefox desktop may skip the OS notification", () => {
    expect(browserMaySkipPushNotification(UA.chromeMac)).toBe(true);
    expect(browserMaySkipPushNotification(UA.firefoxMac)).toBe(true);
    expect(browserMaySkipPushNotification(UA.firefoxAndroid)).toBe(false);
    expect(browserMaySkipPushNotification(UA.safariIos)).toBe(false);
    expect(browserMaySkipPushNotification("")).toBe(false);
  });
});

describe("pushDeliveryPlan", () => {
  it("posts to the visible window and skips the OS notification in Chromium", () => {
    const plan = pushDeliveryPlan([hidden, visible], UA.chromeMac, item);
    expect(plan.postTo).toEqual([visible]);
    expect(plan.showNotification).toBe(false);
  });

  it("posts to every visible window", () => {
    const second = { id: "second", visibilityState: "visible" };
    expect(pushDeliveryPlan([visible, second], UA.firefoxMac, item).postTo).toEqual([
      visible,
      second,
    ]);
  });

  it("shows the notification when no window is visible", () => {
    const plan = pushDeliveryPlan([hidden], UA.chromeMac, item);
    expect(plan.postTo).toEqual([]);
    expect(plan.showNotification).toBe(true);
  });

  it("shows the notification when no window is open", () => {
    expect(pushDeliveryPlan([], UA.chromeMac, item)).toEqual({
      postTo: [],
      showNotification: true,
    });
  });

  it("posts and still shows the notification where the browser forbids a silent push", () => {
    for (const ua of [UA.safariMac, UA.safariIos, UA.chromeIos, UA.firefoxAndroid]) {
      const plan = pushDeliveryPlan([visible], ua, item);
      expect(plan.postTo).toEqual([visible]);
      expect(plan.showNotification).toBe(true);
    }
  });

  it("an older payload without an inbox id posts nothing and shows the notification", () => {
    expect(pushDeliveryPlan([visible], UA.chromeMac, null)).toEqual({
      postTo: [],
      showNotification: true,
    });
  });
});

describe("pushedItemFromMessage", () => {
  it("reads the posted item", () => {
    expect(pushedItemFromMessage({ type: WGW_NOTIFICATION_PUSHED_MESSAGE, item })).toEqual(item);
  });

  it("ignores other messages and items without an id", () => {
    expect(pushedItemFromMessage({ type: "wgw-notification-navigate", navigate: "/" })).toBeNull();
    expect(
      pushedItemFromMessage({ type: WGW_NOTIFICATION_PUSHED_MESSAGE, item: { ...item, id: "" } }),
    ).toBeNull();
    expect(pushedItemFromMessage(null)).toBeNull();
  });
});
