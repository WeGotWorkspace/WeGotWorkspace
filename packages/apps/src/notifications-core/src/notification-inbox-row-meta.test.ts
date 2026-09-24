import { describe, expect, it } from "vitest";
import {
  formatNotificationRelativeTime,
  notificationInboxAppId,
  notificationInboxDomainLabel,
} from "@/notifications-core/src/notification-inbox-row-meta";

describe("notificationInboxAppId", () => {
  it("maps chat to Meet and docs shares to Docs or Drive", () => {
    expect(notificationInboxAppId({ domain: "chat", navigate: "/meet/dms/andrea" })).toBe("meet");
    expect(notificationInboxAppId({ domain: "docs", navigate: "/docs" })).toBe("docs");
    expect(notificationInboxAppId({ domain: "docs", navigate: "/drive" })).toBe("drive");
    expect(notificationInboxAppId({ domain: "calendar", navigate: "/calendar" })).toBe("calendar");
    expect(notificationInboxAppId({ domain: "tasks", navigate: "/tasks" })).toBe("tasks");
  });

  it("falls back to the navigate prefix", () => {
    expect(notificationInboxAppId({ domain: "unknown", navigate: "/notes/abc" })).toBe("notes");
  });
});

describe("notificationInboxDomainLabel", () => {
  it("uses readable title case for the product id", () => {
    expect(notificationInboxDomainLabel("meet")).toBe("Meet");
    expect(notificationInboxDomainLabel("calendar")).toBe("Calendar");
    expect(notificationInboxDomainLabel("notes")).toBe("Notes");
    expect(notificationInboxDomainLabel("docs")).toBe("Docs");
    expect(notificationInboxDomainLabel("tasks")).toBe("Tasks");
    expect(notificationInboxDomainLabel("drive")).toBe("Drive");
  });
});

describe("formatNotificationRelativeTime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  it("uses compact units from the mockup", () => {
    expect(formatNotificationRelativeTime("2026-09-14T11:56:00Z", now)).toBe("4m");
    expect(formatNotificationRelativeTime("2026-09-14T11:38:00Z", now)).toBe("22m");
    expect(formatNotificationRelativeTime("2026-09-14T11:00:00Z", now)).toBe("1h");
    expect(formatNotificationRelativeTime("2026-09-14T10:00:00Z", now)).toBe("2h");
  });

  it("returns now for sub-minute ages and empty for missing dates", () => {
    expect(formatNotificationRelativeTime("2026-09-14T11:59:30Z", now)).toBe("now");
    expect(formatNotificationRelativeTime(null, now)).toBe("");
  });
});
