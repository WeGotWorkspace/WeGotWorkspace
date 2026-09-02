import { describe, expect, it } from "vitest";
import {
  meetCallGivenName,
  meetCallPeerCameraOn,
  meetCallStripPeers,
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

describe("pickMeetCallSpotlight", () => {
  it("prefers the first remote peer with a live mic", () => {
    expect(pickMeetCallSpotlight([maya, felix], self)).toEqual(felix);
  });

  it("falls back to the first remote peer, then self", () => {
    expect(pickMeetCallSpotlight([maya], self).id).toBe("maya");
    expect(pickMeetCallSpotlight([], self)).toEqual(self);
  });
});

describe("meetCallStripPeers", () => {
  it("keeps self and the other remotes, dropping the spotlight", () => {
    expect(meetCallStripPeers(felix, [felix, maya], self).map((peer) => peer.id)).toEqual([
      "self",
      "maya",
    ]);
  });
});

describe("meetCallGivenName", () => {
  it("uses the first token for strip captions", () => {
    expect(meetCallGivenName("Maya Lindqvist")).toBe("Maya");
    expect(meetCallGivenName("You")).toBe("You");
  });
});

describe("meetCallPeerCameraOn", () => {
  it("reads disclosed camera before a stream", () => {
    expect(meetCallPeerCameraOn(felix)).toBe(false);
    expect(meetCallPeerCameraOn({ id: "cam", name: "Cam", stream: {} as MediaStream })).toBe(true);
  });
});
