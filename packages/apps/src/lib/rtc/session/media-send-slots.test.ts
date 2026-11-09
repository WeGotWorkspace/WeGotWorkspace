import { describe, expect, it, vi } from "vitest";
import {
  mediaSenderFor,
  openIdleMediaSendSlots,
  reserveMediaSendSlots,
} from "@/lib/rtc/session/media-send-slots";

type Kind = "audio" | "video";

function track(kind: Kind): MediaStreamTrack {
  return { kind } as MediaStreamTrack;
}

function stream(...tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

function transceiver(
  kind: string,
  direction: RTCRtpTransceiverDirection,
  senderTrack: MediaStreamTrack | null = null,
): RTCRtpTransceiver {
  return {
    direction,
    receiver: { track: { kind } },
    sender: { track: senderTrack },
  } as unknown as RTCRtpTransceiver;
}

function pcWith(transceivers: RTCRtpTransceiver[]): RTCPeerConnection {
  return {
    getTransceivers: () => transceivers,
    getSenders: () => transceivers.map((t) => t.sender),
  } as unknown as RTCPeerConnection;
}

describe("reserveMediaSendSlots", () => {
  it("adds a send-receive video slot when the local stream is audio only", () => {
    const addTransceiver = vi.fn();
    const local = stream(track("audio"));
    reserveMediaSendSlots({ addTransceiver } as unknown as RTCPeerConnection, local);
    expect(addTransceiver).toHaveBeenCalledTimes(1);
    expect(addTransceiver).toHaveBeenCalledWith("video", {
      direction: "sendrecv",
      streams: [local],
    });
  });

  it("adds both slots without a local stream and none when both kinds are sent", () => {
    const empty = vi.fn();
    reserveMediaSendSlots({ addTransceiver: empty } as unknown as RTCPeerConnection, null);
    expect(empty.mock.calls.map(([kind]) => kind)).toEqual(["audio", "video"]);

    const full = vi.fn();
    reserveMediaSendSlots(
      { addTransceiver: full } as unknown as RTCPeerConnection,
      stream(track("audio"), track("video")),
    );
    expect(full).not.toHaveBeenCalled();
  });
});

describe("openIdleMediaSendSlots", () => {
  it("answers an offered slot this side does not send yet as send-receive", () => {
    const video = transceiver("video", "recvonly");
    openIdleMediaSendSlots(pcWith([video]));
    expect(video.direction).toBe("sendrecv");
  });

  it("leaves slots that already send, and non-media transceivers, alone", () => {
    const sending = transceiver("audio", "recvonly", track("audio"));
    const inactive = transceiver("video", "inactive");
    const other = transceiver("application", "recvonly");
    openIdleMediaSendSlots(pcWith([sending, inactive, other]));
    expect(sending.direction).toBe("recvonly");
    expect(inactive.direction).toBe("inactive");
    expect(other.direction).toBe("recvonly");
  });
});

describe("mediaSenderFor", () => {
  it("prefers the sender that already carries the kind", () => {
    const camera = track("video");
    const live = transceiver("video", "sendrecv", camera);
    const slot = transceiver("video", "sendrecv");
    expect(mediaSenderFor(pcWith([slot, live]), "video")).toBe(live.sender);
  });

  it("falls back to an empty send slot after an audio-only join", () => {
    const audio = transceiver("audio", "sendrecv", track("audio"));
    const slot = transceiver("video", "sendrecv");
    expect(mediaSenderFor(pcWith([audio, slot]), "video")).toBe(slot.sender);
  });

  it("returns null when the only slot cannot send", () => {
    expect(mediaSenderFor(pcWith([transceiver("video", "recvonly")]), "video")).toBeNull();
  });
});
