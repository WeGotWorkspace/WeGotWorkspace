/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useMeetLocalMedia,
  type MeetLocalMediaHolders,
} from "@/meet-core/src/use-meet-local-media";

type MeetRtc = Parameters<typeof useMeetLocalMedia>[0]["meetRtc"];

type FakeTrack = MediaStreamTrack & { enabled: boolean };

function fakeTrack(kind: "audio" | "video", id: string): FakeTrack {
  return { kind, id, enabled: true, stop: vi.fn() } as unknown as FakeTrack;
}

function fakeStream(...tracks: FakeTrack[]): MediaStream {
  const list = [...tracks];
  return {
    getTracks: () => [...list],
    getAudioTracks: () => list.filter((track) => track.kind === "audio"),
    getVideoTracks: () => list.filter((track) => track.kind === "video"),
    addTrack: (track: FakeTrack) => list.push(track),
    removeTrack: (track: FakeTrack) => list.splice(list.indexOf(track), 1),
  } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function stubMediaDevices(getUserMedia: () => Promise<MediaStream>) {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(getUserMedia),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function holders(stream: MediaStream | null): MeetLocalMediaHolders {
  return {
    localStream: { current: stream },
    screenStream: { current: null },
    cameraTrack: { current: stream?.getVideoTracks()[0] ?? null },
    selectedMicId: { current: null },
    selectedCamId: { current: null },
  };
}

/** Mirrors `MeetCallStore`: the setter writes the ref synchronously, then renders. */
function useHarness(
  initial: { mic: boolean; video: boolean },
  mediaHolders: MeetLocalMediaHolders,
) {
  const micOnRef = useRef(initial.mic);
  const videoOnRef = useRef(initial.video);
  const screenOnRef = useRef(false);
  const [micOn, setMicState] = useState(initial.mic);
  const [videoOn, setVideoState] = useState(initial.video);
  const setMicOn = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    micOnRef.current = typeof value === "function" ? value(micOnRef.current) : value;
    setMicState(micOnRef.current);
  }, []);
  const setVideoOn = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    videoOnRef.current = typeof value === "function" ? value(videoOnRef.current) : value;
    setVideoState(videoOnRef.current);
  }, []);
  const media = useMeetLocalMedia({
    meetRtc: {
      replaceAudioTrack: vi.fn(async () => undefined),
      replaceVideoTrack: vi.fn(async () => undefined),
      setEncodingPrefs: vi.fn(),
    } as unknown as MeetRtc,
    mediaHolders,
    micOn,
    videoOn,
    screenOn: false,
    setMicOn,
    setVideoOn,
    setScreenOn: vi.fn(),
    setError: vi.fn(),
    announceMediaPresence: vi.fn(async () => undefined),
    micOnRef,
    videoOnRef,
    screenOnRef,
  });
  return { media, setMicOn, setVideoOn };
}

describe("useMeetLocalMedia camera state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the camera off when it is switched off while the permission prompt is open", async () => {
    const camera = fakeTrack("video", "cam");
    const prompt = deferred<MediaStream>();
    stubMediaDevices(() => prompt.promise);
    const mediaHolders = holders(null);
    const { result } = renderHook(() => useHarness({ mic: true, video: false }, mediaHolders));

    act(() => result.current.media.toggleVideo());
    act(() => result.current.media.toggleVideo());
    await act(async () => {
      prompt.resolve(fakeStream(fakeTrack("audio", "mic"), camera));
      await prompt.promise;
    });

    expect(camera.enabled).toBe(false);
  });

  it("turns a live camera off when video is switched off outside the toggle", () => {
    stubMediaDevices(async () => fakeStream());
    const camera = fakeTrack("video", "cam");
    const mic = fakeTrack("audio", "mic");
    const mediaHolders = holders(fakeStream(mic, camera));
    const { result } = renderHook(() => useHarness({ mic: true, video: true }, mediaHolders));

    act(() => result.current.setVideoOn(false));
    act(() => result.current.setMicOn(false));

    expect(camera.enabled).toBe(false);
    expect(mic.enabled).toBe(false);
  });

  it("keeps a switched camera off when video was switched off during the switch", async () => {
    const next = fakeTrack("video", "cam-2");
    const switching = deferred<MediaStream>();
    stubMediaDevices(() => switching.promise);
    const mediaHolders = holders(
      fakeStream(fakeTrack("audio", "mic"), fakeTrack("video", "cam-1")),
    );
    const { result } = renderHook(() => useHarness({ mic: true, video: true }, mediaHolders));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.media.switchCamera("cam-2");
    });
    act(() => result.current.setVideoOn(false));
    await act(async () => {
      switching.resolve(fakeStream(next));
      await pending;
    });

    expect(next.enabled).toBe(false);
  });
});
