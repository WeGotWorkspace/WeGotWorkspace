import { describe, expect, it } from "vitest";
import {
  MEET_CHANNELS_ROUTE,
  MEET_DMS_ROUTE,
  MEET_MEETINGS_ROUTE,
  meetIsAdHocMeetingId,
  meetLegacyRedirect,
  meetLiveRouteShowsInviteGate,
  meetRouteIsGuestClosed,
  meetNavigatePathFromSelection,
  meetMeetingPathId,
  meetNavigateTargetFromSelection,
  meetSelectionFromRouteParams,
} from "@/meet-core/src/meet-chat-route";

describe("meetSelectionFromRouteParams", () => {
  it("maps a public channels route id onto the chat- collection selection", () => {
    expect(meetSelectionFromRouteParams({ channelId: "design-reviews" })).toBe(
      "chat-design-reviews",
    );
    expect(meetSelectionFromRouteParams({ channelId: "chat-design-reviews" })).toBe(
      "chat-design-reviews",
    );
  });

  it("maps a dms route principal onto the virtual dm:{peer} selection key", () => {
    expect(meetSelectionFromRouteParams({ peerId: "alice" })).toBe("dm:alice");
    expect(meetSelectionFromRouteParams({ peerId: "ada.lovelace" })).toBe("dm:ada.lovelace");
  });

  it("maps cheap legacy /meet/{id} params onto the same selection keys", () => {
    expect(meetSelectionFromRouteParams({ legacyId: "chat-general" })).toBe("chat-general");
    expect(meetSelectionFromRouteParams({ legacyId: "dm:alice" })).toBe("dm:alice");
    expect(
      meetSelectionFromRouteParams({
        legacyId: "dm-0123456789abcdef0123456789abcdef01234567",
      }),
    ).toBeNull();
  });

  it("maps a persisted meetings route id onto the chat- collection selection", () => {
    expect(meetSelectionFromRouteParams({ meetingId: "test-meet" })).toBe("chat-test-meet");
    expect(meetSelectionFromRouteParams({ meetingId: "h8y8-ewp6-al8n" })).toBeNull();
  });

  it("returns null on bare /meet (no nested params)", () => {
    expect(meetSelectionFromRouteParams({})).toBeNull();
  });
});

describe("meetIsAdHocMeetingId", () => {
  it("treats leftover room codes as invite ids and collection slugs as workspace", () => {
    expect(meetIsAdHocMeetingId("h8y8-ewp6-al8n")).toBe(true);
    expect(meetIsAdHocMeetingId("test-meet")).toBe(false);
    expect(meetIsAdHocMeetingId(null)).toBe(false);
  });
});

describe("meetLiveRouteShowsInviteGate", () => {
  it("keeps a signed-in workspace mounted for channels, persisted meetings, and ad-hoc codes", () => {
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: true,
        meetingId: "h8y8-ewp6-al8n",
        onConversationRoute: false,
        inviteRoom: "h8y8-ewp6-al8n",
      }),
    ).toBe(false);
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: true,
        meetingId: "standup",
        onConversationRoute: true,
        inviteRoom: null,
      }),
    ).toBe(false);
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: true,
        meetingId: null,
        onConversationRoute: true,
        inviteRoom: null,
      }),
    ).toBe(false);
  });

  it("uses the invite gate for signed-out meeting URLs and leftover room search", () => {
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: false,
        meetingId: "h8y8-ewp6-al8n",
        onConversationRoute: false,
        inviteRoom: "h8y8-ewp6-al8n",
      }),
    ).toBe(true);
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: false,
        meetingId: "standup",
        onConversationRoute: true,
        inviteRoom: null,
      }),
    ).toBe(true);
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: false,
        meetingId: null,
        onConversationRoute: false,
        inviteRoom: "h8y8-ewp6-al8n",
      }),
    ).toBe(true);
  });

  it("closes channels, DMs, and saved meetings to guests and leaves ad-hoc codes open", () => {
    expect(meetRouteIsGuestClosed({ channelId: "general" })).toBe(true);
    expect(meetRouteIsGuestClosed({ peerId: "alice" })).toBe(true);
    expect(meetRouteIsGuestClosed({ persistedMeetingId: "chat-standup" })).toBe(true);
    expect(meetRouteIsGuestClosed({ legacyId: "chat-general" })).toBe(true);
    expect(meetRouteIsGuestClosed({ legacyId: "h8y8-ewp6-al8n" })).toBe(false);
    expect(meetRouteIsGuestClosed({})).toBe(false);
  });

  it("keeps signed-out channel and DM routes on the workspace gate", () => {
    expect(
      meetLiveRouteShowsInviteGate({
        signedIn: false,
        meetingId: null,
        onConversationRoute: true,
        inviteRoom: "h8y8-ewp6-al8n",
      }),
    ).toBe(false);
  });
});

describe("meetNavigateTargetFromSelection", () => {
  it("writes channels as /meet/channels/{public id} without a chat- prefix", () => {
    expect(meetNavigateTargetFromSelection("chat-design-reviews")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "design-reviews" },
    });
    expect(meetNavigateTargetFromSelection("design-reviews")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "design-reviews" },
    });
  });

  it("writes meeting-kind collections as /meet/meetings/{public id}", () => {
    expect(meetNavigateTargetFromSelection("chat-test-meet", { kind: "meeting" })).toEqual({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: "test-meet" },
    });
  });

  it("writes an ad-hoc meeting as its room code, not the collection slug", () => {
    expect(
      meetNavigateTargetFromSelection("chat-jo", {
        kind: "meeting",
        guestRoomCode: "g744-8kfg-adjz",
      }),
    ).toEqual({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: "g744-8kfg-adjz" },
    });
    expect(meetMeetingPathId("chat-jo", { kind: "meeting", guestRoomCode: "G744-8KFG-ADJZ" })).toBe(
      "g744-8kfg-adjz",
    );
  });

  it("writes DMs as /meet/dms/{peer} without dm: or dm- in the path", () => {
    expect(meetNavigateTargetFromSelection("dm:alice")).toEqual({
      to: MEET_DMS_ROUTE,
      params: { peerId: "alice" },
    });
  });
});

describe("meetNavigatePathFromSelection", () => {
  it("builds suite-notify navigate paths from selection keys", () => {
    expect(meetNavigatePathFromSelection("dm:Alice")).toBe("/meet/dms/alice");
    expect(meetNavigatePathFromSelection("chat-design-reviews")).toBe(
      "/meet/channels/design-reviews",
    );
    expect(meetNavigatePathFromSelection("chat-test-meet", { kind: "meeting" })).toBe(
      "/meet/meetings/test-meet",
    );
  });
});

describe("meetLegacyRedirect", () => {
  it("rewrites dm:{peer} to /meet/dms/{peer}", () => {
    expect(meetLegacyRedirect("dm:alice")).toEqual({
      to: MEET_DMS_ROUTE,
      params: { peerId: "alice" },
    });
    expect(meetLegacyRedirect("dm%3Aalice")).toEqual({
      to: MEET_DMS_ROUTE,
      params: { peerId: "alice" },
    });
  });

  it("rewrites chat-… and other channel ids to /meet/channels/{public id}", () => {
    expect(meetLegacyRedirect("chat-general")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "general" },
    });
    expect(meetLegacyRedirect("design-reviews")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "design-reviews" },
    });
  });

  it("does not treat server dm-{hash} collections as a peer (falls back to /meet)", () => {
    expect(meetLegacyRedirect("dm-0123456789abcdef0123456789abcdef01234567")).toEqual({
      to: "/meet",
    });
  });

  it("does not treat nested segment names as channel ids", () => {
    expect(meetLegacyRedirect("channels")).toEqual({ to: "/meet" });
    expect(meetLegacyRedirect("dms")).toEqual({ to: "/meet" });
    expect(meetLegacyRedirect("meetings")).toEqual({ to: "/meet" });
  });
});
