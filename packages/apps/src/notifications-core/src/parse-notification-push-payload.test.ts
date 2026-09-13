import { describe, expect, it } from "vitest";
import { parseNotificationPushPayload } from "./parse-notification-push-payload";

describe("parseNotificationPushPayload", () => {
  it("parses the declarative application/notification+json shape", () => {
    const parsed = parseNotificationPushPayload({
      title: "Standup",
      body: "Starts in 15 minutes",
      navigate: "/calendar",
      tag: "calendar.alert_due:x",
      renotify: true,
      app_badge: 1,
    });
    expect(parsed).toEqual({
      title: "Standup",
      body: "Starts in 15 minutes",
      navigate: "/calendar",
      tag: "calendar.alert_due:x",
      renotify: true,
      app_badge: 1,
    });
  });

  it("rejects missing title and sanitizes navigate", () => {
    expect(parseNotificationPushPayload({ body: "x" })).toBeNull();
    expect(
      parseNotificationPushPayload({ title: "Hi", navigate: "https://evil.example" })?.navigate,
    ).toBe("/");
  });
});
