import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const calendarAppSource = readFileSync(join(here, "calendar-app.tsx"), "utf8");

describe("CalendarApp Join navigation", () => {
  it("opens meetings through openCalendarMeetHref instead of location.assign", () => {
    expect(calendarAppSource).toContain("openCalendarMeetHref(href, window.location.origin)");
    expect(calendarAppSource).not.toMatch(/location\.assign\(`\/meet/);
    expect(calendarAppSource).not.toContain("/meet/guest?room=");
  });

  it("passes the same onJoinMeeting callback into CalendarWorkspace", () => {
    expect(calendarAppSource).toContain("onJoinMeeting={handleJoinMeeting}");
  });
});
