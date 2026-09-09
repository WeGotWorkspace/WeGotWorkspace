import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const meetChatAppSource = readFileSync(join(here, "meet-chat-app.tsx"), "utf8");

describe("MeetChatApp upcoming join", () => {
  it("stays in MeetChatApp instead of location.assign or a new window", () => {
    expect(meetChatAppSource).toContain("meetUpcomingJoinTarget");
    expect(meetChatAppSource).toContain("handleSelectedChannelChange");
    expect(meetChatAppSource).not.toContain("joinAdHocRoom");
    expect(meetChatAppSource).not.toMatch(/startCall\?\.\(target/);
    expect(meetChatAppSource).not.toMatch(/location\.assign\(href\)/);
    expect(meetChatAppSource).not.toMatch(/location\.assign\(target/);
    expect(meetChatAppSource).not.toMatch(/window\.open\(/);
    expect(meetChatAppSource).toContain("MEET_MEETINGS_ROUTE");
    expect(meetChatAppSource).toMatch(/row\?\.kind !== "meeting"/);
    expect(meetChatAppSource).toContain("useMeetNowClock");
    expect(meetChatAppSource).toContain("nowTick");
  });

  it("deletes matching calendar events with the channel and drops them from local state", () => {
    expect(meetChatAppSource).toContain("events: calendarEvents");
    expect(meetChatAppSource).toContain("patchEvent: calendarApi.operations?.patchEvent");
    expect(meetChatAppSource).toContain("deleteEvent: calendarApi.operations?.deleteEvent");
    expect(meetChatAppSource).toContain("onEventUpdated: handleEventUpdated");
    expect(meetChatAppSource).toContain("onEventDeleted: handleEventDeleted");
    expect(meetChatAppSource).toContain("setDeletedEventIds");
    expect(meetChatAppSource).toContain("byId.delete(eventId)");
  });
});

describe("MeetChatApp in-call resume", () => {
  it("restores the persisted live call channel when remounting on /meet", () => {
    expect(meetChatAppSource).toContain("meetResumeLiveCallChannelId");
    expect(meetChatAppSource).toContain("resumeLiveCallChannelId");
    expect(meetChatAppSource).toContain("setLiveCallChannelId");
    expect(meetChatAppSource).toContain("clearLiveCallResume");
    expect(meetChatAppSource).toContain(
      "initialChannelId={routeChannelId ?? resumeLiveCallChannelId ?? undefined}",
    );
    expect(meetChatAppSource).toContain("liveCallChannelId={resumeLiveCallChannelId}");
  });
});
