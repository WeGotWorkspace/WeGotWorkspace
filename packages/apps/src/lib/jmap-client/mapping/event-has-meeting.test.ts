import { describe, expect, it } from "vitest";
import { jmapEventToInternalRows } from "./event";
import type { JmapCalendarEvent } from "../calendars/types";

const base = {
  uid: "e1",
  title: "Call",
  start: "2026-11-26T13:00:00",
  duration: "PT1H",
  calendarIds: { default: true },
} as unknown as JmapCalendarEvent;

describe("jmapEventToInternalRows hasMeeting", () => {
  it("flags an event with a meeting link, not one without", () => {
    const withLink = {
      ...base,
      links: { meet: { "@type": "Link", href: "https://meet.test/room", rel: "alternate" } },
    } as unknown as JmapCalendarEvent;
    expect(jmapEventToInternalRows(withLink, {})[0]?.event.data.hasMeeting).toBe(true);
    expect(jmapEventToInternalRows(base, {})[0]?.event.data.hasMeeting).toBeUndefined();
  });
});
