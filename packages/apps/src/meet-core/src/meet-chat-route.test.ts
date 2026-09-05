import { describe, expect, it } from "vitest";
import {
  MEET_CHANNELS_ROUTE,
  MEET_DMS_ROUTE,
  meetLegacyRedirect,
  meetNavigateTargetFromSelection,
  meetSelectionFromRouteParams,
} from "@/meet-core/src/meet-chat-route";

describe("meetSelectionFromRouteParams", () => {
  it("maps a channels route id 1:1 onto the workspace selection", () => {
    expect(meetSelectionFromRouteParams({ channelId: "chat-design-reviews" })).toBe(
      "chat-design-reviews",
    );
    expect(meetSelectionFromRouteParams({ channelId: "design-reviews" })).toBe("design-reviews");
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

  it("returns null on bare /meet (no nested params)", () => {
    expect(meetSelectionFromRouteParams({})).toBeNull();
  });
});

describe("meetNavigateTargetFromSelection", () => {
  it("writes channels as /meet/channels/{MeetChannel.id}", () => {
    expect(meetNavigateTargetFromSelection("chat-design-reviews")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "chat-design-reviews" },
    });
    expect(meetNavigateTargetFromSelection("design-reviews")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "design-reviews" },
    });
  });

  it("writes DMs as /meet/dms/{peer} without dm: or dm- in the path", () => {
    expect(meetNavigateTargetFromSelection("dm:alice")).toEqual({
      to: MEET_DMS_ROUTE,
      params: { peerId: "alice" },
    });
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

  it("rewrites chat-… and other channel ids to /meet/channels/{id}", () => {
    expect(meetLegacyRedirect("chat-general")).toEqual({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: "chat-general" },
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
  });
});
