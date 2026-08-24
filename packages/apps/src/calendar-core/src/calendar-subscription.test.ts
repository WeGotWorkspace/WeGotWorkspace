import { describe, expect, it } from "vitest";
import {
  canPublishCalendar,
  inferCalendarNameFromUrl,
  isLikelyCalendarFeedUrl,
  isSubscribedCalendar,
  writableCalendarId,
} from "@/calendar-core/src/calendar-subscription";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

const personal: CalendarInfo = {
  id: "default",
  name: "Personal",
  color: "#6366f1",
  mayWrite: true,
  isDefault: true,
};

const subscribed: CalendarInfo = {
  id: "holidays",
  name: "US Holidays",
  color: "#8b5cf6",
  mayWrite: false,
  subscriptionId: "sub-1",
};

const group: CalendarInfo = {
  id: "group-editorial",
  name: "Editorial",
  color: "#22c55e",
  mayWrite: true,
  scope: "group",
  groupSlug: "editorial",
};

describe("calendar subscription helpers", () => {
  it("treats subscriptionId as the remote-feed marker", () => {
    expect(isSubscribedCalendar(personal)).toBe(false);
    expect(isSubscribedCalendar(subscribed)).toBe(true);
  });

  it("allows publish only on owned personal writable calendars", () => {
    expect(canPublishCalendar(personal)).toBe(true);
    expect(canPublishCalendar(subscribed)).toBe(false);
    expect(canPublishCalendar(group)).toBe(false);
    expect(canPublishCalendar({ ...personal, mayWrite: false })).toBe(false);
  });

  it("never picks a subscribed calendar for create", () => {
    expect(writableCalendarId([subscribed, personal], "holidays")).toBe("default");
    expect(writableCalendarId([subscribed], "holidays")).toBeUndefined();
  });

  it("accepts http(s) and webcal without fetching", () => {
    expect(isLikelyCalendarFeedUrl("https://feeds.example.test/holidays.ics")).toBe(true);
    expect(isLikelyCalendarFeedUrl("webcal://feeds.example.test/holidays.ics")).toBe(true);
    expect(isLikelyCalendarFeedUrl("ftp://feeds.example.test/holidays.ics")).toBe(false);
    expect(isLikelyCalendarFeedUrl("not a url")).toBe(false);
  });

  it("infers a friendly name from the last path segment or host", () => {
    expect(inferCalendarNameFromUrl("https://feeds.example.test/us-public-holidays.ics")).toBe(
      "Us Public Holidays",
    );
    expect(inferCalendarNameFromUrl("webcal://www.example.test/")).toBe("example.test");
    expect(inferCalendarNameFromUrl("not a url")).toBe("");
  });
});
