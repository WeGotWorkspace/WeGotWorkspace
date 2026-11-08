import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaBinding } from "@/lib/rtc/session/bindings";

describe("createMediaBinding", () => {
  beforeEach(() => {
    class MockMediaStream {
      private tracks: MediaStreamTrack[] = [];

      addTrack(track: MediaStreamTrack) {
        if (!this.tracks.includes(track)) this.tracks.push(track);
      }

      getTracks() {
        return this.tracks;
      }
    }

    vi.stubGlobal("MediaStream", MockMediaStream);
  });

  it("notifies onRemoteStream when ontrack fires", () => {
    const onRemoteStream = vi.fn();
    const binding = createMediaBinding({
      getLocalStream: () => null,
      onRemoteStream,
    });

    const pc = {
      addTrack: vi.fn(),
      ontrack: null as RTCPeerConnection["ontrack"],
    } as unknown as RTCPeerConnection;

    const remoteStream = binding.attach(pc, "REMOTE1");
    expect(pc.ontrack).toBeTypeOf("function");

    const track = { kind: "audio" } as MediaStreamTrack;
    pc.ontrack?.({
      track,
      streams: [],
    } as unknown as RTCTrackEvent);

    expect(remoteStream.getTracks()).toContain(track);
    expect(onRemoteStream).toHaveBeenCalledWith("REMOTE1", remoteStream);
  });

  it("reserves a video send slot on the initiator side of an audio-only join", () => {
    const audio = { kind: "audio" } as MediaStreamTrack;
    const local = {
      getTracks: () => [audio],
      getAudioTracks: () => [audio],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const binding = createMediaBinding({ getLocalStream: () => local });
    const initiatorPc = {
      addTrack: vi.fn(),
      addTransceiver: vi.fn(),
    } as unknown as RTCPeerConnection;
    const answererPc = {
      addTrack: vi.fn(),
      addTransceiver: vi.fn(),
    } as unknown as RTCPeerConnection;

    binding.attach(initiatorPc, "REMOTE1", true);
    binding.attach(answererPc, "REMOTE2", false);

    expect(initiatorPc.addTrack).toHaveBeenCalledWith(audio, local);
    expect(initiatorPc.addTransceiver).toHaveBeenCalledWith("video", {
      direction: "sendrecv",
      streams: [local],
    });
    // The answerer only opens the slots its offer brings, in `prepareAnswer`.
    expect(answererPc.addTransceiver).not.toHaveBeenCalled();
  });
});
