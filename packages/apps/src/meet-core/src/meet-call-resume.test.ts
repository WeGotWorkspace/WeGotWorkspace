import { describe, expect, it } from "vitest";
import {
  meetCallMiniPlayerVisible,
  meetCallStatusEngaged,
  meetCallUiParkedOnWorkspaceUnmount,
  meetResumeCallNavigateTarget,
  meetResumeLiveCallChannelId,
  meetShouldSelectLiveCallOnBareMeet,
} from "@/meet-core/src/meet-call-resume";
import {
  MEET_CHANNELS_ROUTE,
  MEET_DMS_ROUTE,
  MEET_MEETINGS_ROUTE,
} from "@/meet-core/src/meet-chat-route";

describe("meetCallStatusEngaged", () => {
  it("treats in-call, preparing, and waiting as live", () => {
    expect(meetCallStatusEngaged("in-call")).toBe(true);
    expect(meetCallStatusEngaged("preparing")).toBe(true);
    expect(meetCallStatusEngaged("waiting")).toBe(true);
    expect(meetCallStatusEngaged("idle")).toBe(false);
    expect(meetCallStatusEngaged("failed")).toBe(false);
  });
});

describe("meetCallMiniPlayerVisible", () => {
  it("shows outside /meet whenever the call is engaged", () => {
    expect(
      meetCallMiniPlayerVisible({ callEngaged: true, onMeetPath: false, callUiParked: false }),
    ).toBe(true);
  });

  it("hides on /meet until the call is parked (chrome not on screen)", () => {
    expect(
      meetCallMiniPlayerVisible({ callEngaged: true, onMeetPath: true, callUiParked: false }),
    ).toBe(false);
    expect(
      meetCallMiniPlayerVisible({ callEngaged: true, onMeetPath: true, callUiParked: true }),
    ).toBe(true);
  });

  it("hides when the call is not engaged", () => {
    expect(
      meetCallMiniPlayerVisible({ callEngaged: false, onMeetPath: false, callUiParked: true }),
    ).toBe(false);
  });
});

describe("meetResumeLiveCallChannelId", () => {
  it("prefers the mapping from the current mount", () => {
    expect(
      meetResumeLiveCallChannelId({
        computed: "chat-general",
        persisted: "dm:alice",
        callEngaged: true,
      }),
    ).toBe("chat-general");
  });

  it("keeps the persisted id across a remount while the call is still live", () => {
    expect(
      meetResumeLiveCallChannelId({
        computed: null,
        persisted: "dm:alice",
        callEngaged: true,
      }),
    ).toBe("dm:alice");
  });

  it("drops the persisted id once the call has ended", () => {
    expect(
      meetResumeLiveCallChannelId({
        computed: null,
        persisted: "chat-general",
        callEngaged: false,
      }),
    ).toBeNull();
  });
});

describe("meetShouldSelectLiveCallOnBareMeet", () => {
  it("selects the live call when the app switcher lands on bare /meet", () => {
    expect(
      meetShouldSelectLiveCallOnBareMeet({
        routeChannelId: null,
        liveCallChannelId: "chat-design",
      }),
    ).toBe("chat-design");
  });

  it("does not steal selection from a nested Meet route (parked on another channel)", () => {
    expect(
      meetShouldSelectLiveCallOnBareMeet({
        routeChannelId: "chat-random",
        liveCallChannelId: "chat-design",
      }),
    ).toBeNull();
  });

  it("is a no-op when there is no live call", () => {
    expect(
      meetShouldSelectLiveCallOnBareMeet({
        routeChannelId: null,
        liveCallChannelId: null,
      }),
    ).toBeNull();
  });
});

describe("meetCallUiParkedOnWorkspaceUnmount", () => {
  it("keeps the overlay parked so returning to /meet does not drop it", () => {
    expect(meetCallUiParkedOnWorkspaceUnmount(true)).toBe(true);
    expect(meetCallUiParkedOnWorkspaceUnmount(false)).toBe(false);
  });
});

describe("meetResumeCallNavigateTarget", () => {
  it("returns the nested channel path instead of /meet?room=", () => {
    expect(meetResumeCallNavigateTarget({ liveCallChannelId: "chat-design-reviews" })).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "design-reviews" },
    });
  });

  it("returns the meetings path for meeting-kind collections", () => {
    expect(
      meetResumeCallNavigateTarget({
        liveCallChannelId: "chat-test-meet",
        liveCallChannelKind: "meeting",
      }),
    ).toEqual({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: "test-meet" },
    });
  });

  it("returns the DM path", () => {
    expect(meetResumeCallNavigateTarget({ liveCallChannelId: "dm:alice" })).toEqual({
      to: MEET_DMS_ROUTE,
      params: { peerId: "alice" },
    });
  });

  it("maps leftover room codes onto /meet/meetings/{id}", () => {
    expect(
      meetResumeCallNavigateTarget({
        liveCallChannelId: null,
        roomCode: "h8y8-ewp6-al8n",
      }),
    ).toEqual({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: "h8y8-ewp6-al8n" },
    });
  });

  it("falls back to bare /meet when nothing is known", () => {
    expect(meetResumeCallNavigateTarget({ liveCallChannelId: null, roomCode: null })).toEqual({
      to: "/meet",
    });
  });
});
