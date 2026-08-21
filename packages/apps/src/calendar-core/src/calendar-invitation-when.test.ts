import { describe, expect, it } from "vitest";
import { formatInvitationWhen } from "@/calendar-core/src/calendar-invitation-when";

describe("formatInvitationWhen", () => {
  it("returns null when start is missing or invalid", () => {
    expect(formatInvitationWhen(null, null, "en-US")).toBeNull();
    expect(formatInvitationWhen("not-a-date", null, "en-US")).toBeNull();
  });

  it("formats a date-only start without shifting the calendar day", () => {
    expect(formatInvitationWhen("2026-08-20", null, "en-US")).toBe("Thu, Aug 20");
  });

  it("formats a date-only range", () => {
    expect(formatInvitationWhen("2026-08-20", "2026-08-22", "en-US")).toBe(
      "Thu, Aug 20 – Sat, Aug 22",
    );
  });

  it("formats a same-day timed range", () => {
    expect(formatInvitationWhen("2026-08-20T14:00:00", "2026-08-20T15:30:00", "en-US")).toMatch(
      /Thu, Aug 20 · 2:00\sPM–3:30\sPM/,
    );
  });
});
