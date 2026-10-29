import { describe, expect, it } from "vitest";
import { parseNotificationPushPayload } from "./parse-notification-push-payload";

describe("parseNotificationPushPayload", () => {
  it("parses the flat application/notification+json shape", () => {
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
      declarative: false,
      scope: "/",
    });
  });

  it("parses Safari declarative web_push + nested notification", () => {
    const parsed = parseNotificationPushPayload({
      web_push: 8030,
      notification: {
        title: "#general",
        body: "Alice: halo",
        navigate: "https://wegot.example/meet/channels/general",
        tag: "chat.message:1",
        renotify: true,
        app_badge: 1,
        silent: false,
      },
      title: "#general",
      body: "Alice: halo",
      navigate: "/meet/channels/general",
    });
    expect(parsed?.title).toBe("#general");
    expect(parsed?.body).toBe("Alice: halo");
    expect(parsed?.navigate).toBe("/meet/channels/general");
    expect(parsed?.declarative).toBe(true);
  });

  it("rejects missing title and sanitizes navigate", () => {
    expect(parseNotificationPushPayload({ body: "x" })).toBeNull();
    expect(
      parseNotificationPushPayload({ title: "Hi", navigate: "https://evil.example" })?.navigate,
    ).toBe("/");
  });

  it("reads the scope of the app that received the push", () => {
    expect(
      parseNotificationPushPayload({ title: "Hi", navigate: "/docs", scope: "/docs" })?.scope,
    ).toBe("/docs");
    expect(
      parseNotificationPushPayload({
        web_push: 8030,
        notification: { title: "Hi", navigate: "https://wegot.example/meet" },
        scope: "/meet",
      })?.scope,
    ).toBe("/meet");
  });

  it("falls back to the suite scope for old payloads and unknown scopes", () => {
    expect(parseNotificationPushPayload({ title: "Hi" })?.scope).toBe("/");
    expect(parseNotificationPushPayload({ title: "Hi", scope: "/evil" })?.scope).toBe("/");
    expect(parseNotificationPushPayload({ title: "Hi", scope: 3 })?.scope).toBe("/");
  });
});
