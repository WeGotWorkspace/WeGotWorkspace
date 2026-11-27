import { describe, expect, it } from "vitest";
import { effectiveMeetingUrl, meetingHrefFromLocation } from "./calendar-meet-link";

describe("effectiveMeetingUrl", () => {
  it("takes an http(s) URL from the location only when it is the whole location", () => {
    expect(meetingHrefFromLocation("https://meet.test/a")).toBe("https://meet.test/a");
    expect(meetingHrefFromLocation("  http://meet.test/a ")).toBe("http://meet.test/a");
    expect(meetingHrefFromLocation("Room 4")).toBe("");
    expect(meetingHrefFromLocation("Room 4 https://meet.test/a")).toBe("");
    expect(meetingHrefFromLocation("javascript:alert(1)")).toBe("");
    expect(meetingHrefFromLocation(undefined)).toBe("");
  });

  it("prefers the dedicated link over the location", () => {
    expect(effectiveMeetingUrl("https://a.test", "https://b.test")).toBe("https://a.test");
    expect(effectiveMeetingUrl("", "https://b.test")).toBe("https://b.test");
    expect(effectiveMeetingUrl("", "Room")).toBe("");
  });
});
