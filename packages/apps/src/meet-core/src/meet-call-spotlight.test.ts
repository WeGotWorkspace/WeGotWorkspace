import { describe, expect, it } from "vitest";
import {
  meetCallGridColumns,
  meetCallPeerScreenSharing,
  pickMeetCallSpotlight,
  type MeetCallSpotlightPeer,
} from "@/meet-core/src/meet-call-spotlight";

const self: MeetCallSpotlightPeer = {
  id: "self",
  name: "Demo User",
  disclosedMedia: { camera: false, mic: true },
};

const felix: MeetCallSpotlightPeer = {
  id: "felix",
  name: "Felix Bauer",
  disclosedMedia: { camera: false, mic: true },
};

const maya: MeetCallSpotlightPeer = {
  id: "maya",
  name: "Maya Lindqvist",
  disclosedMedia: { camera: false, mic: false },
};

const presenter: MeetCallSpotlightPeer = {
  id: "presenter",
  name: "Jonas Pereira",
  // Camera toggled off while sharing — the video track carries the screen.
  disclosedMedia: { camera: false, mic: false, screen: true },
};

describe("pickMeetCallSpotlight", () => {
  it("prefers the first remote peer with a live mic", () => {
    expect(pickMeetCallSpotlight([maya, felix], self)).toEqual(felix);
  });

  it("falls back to the first remote peer, then self", () => {
    expect(pickMeetCallSpotlight([maya], self).id).toBe("maya");
    expect(pickMeetCallSpotlight([], self)).toEqual(self);
  });

  it("gives a remote screen share the spotlight over a speaking peer", () => {
    expect(pickMeetCallSpotlight([felix, presenter], self)).toEqual(presenter);
  });
});

describe("meetCallGridColumns", () => {
  it("maps a single person to fullscreen and grows by square bands", () => {
    expect(meetCallGridColumns(0)).toBe(1);
    expect(meetCallGridColumns(1)).toBe(1);
    expect(meetCallGridColumns(2)).toBe(2);
    expect(meetCallGridColumns(3)).toBe(2);
    expect(meetCallGridColumns(4)).toBe(2);
    expect(meetCallGridColumns(5)).toBe(3);
    expect(meetCallGridColumns(9)).toBe(3);
    expect(meetCallGridColumns(10)).toBe(4);
    expect(meetCallGridColumns(16)).toBe(4);
    expect(meetCallGridColumns(17)).toBe(5);
  });
});

describe("meetCallPeerScreenSharing", () => {
  it("only reports peers that announced a screen share", () => {
    expect(meetCallPeerScreenSharing(presenter)).toBe(true);
    expect(meetCallPeerScreenSharing(felix)).toBe(false);
    expect(meetCallPeerScreenSharing({ id: "bare", name: "Bare" })).toBe(false);
  });
});
