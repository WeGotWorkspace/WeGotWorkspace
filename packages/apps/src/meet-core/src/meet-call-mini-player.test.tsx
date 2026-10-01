import { cleanup, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetCallMiniPlayer } from "@/meet-core/src/meet-call-mini-player";
import { MeetCallProvider } from "@/meet-core/src/meet-call-provider";
import { createMeetCallStore, type MeetCallStore } from "@/meet-core/src/meet-call-store";
import type { MeetRemotePeer } from "@/meet-core/src/meet-call-types";
import { TooltipProvider } from "@/ui/tooltip";

type LoudStream = MediaStream & { loud: boolean };

class FakeAnalyser {
  fftSize = 256;
  stream: LoudStream | null = null;

  getByteTimeDomainData(samples: Uint8Array) {
    samples.fill(this.stream?.loud ? 255 : 128);
  }

  connect() {}

  disconnect() {}
}

class FakeSource {
  constructor(private readonly stream: LoudStream) {}

  connect(analyser: FakeAnalyser) {
    analyser.stream = this.stream;
  }

  disconnect() {}
}

class FakeAudioContext {
  createMediaStreamSource(stream: LoudStream) {
    return new FakeSource(stream);
  }

  createAnalyser() {
    return new FakeAnalyser();
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

function installLoudAudioContext() {
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

function track(kind: "audio" | "video"): MediaStreamTrack {
  return {
    kind,
    id: `${kind}-${Math.random().toString(36).slice(2)}`,
    label: "",
    readyState: "live",
    enabled: true,
    muted: false,
    getSettings: () => ({}),
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStreamTrack;
}

function loudStream(kinds: Array<"audio" | "video">, loud: boolean): LoudStream {
  const tracks = kinds.map((kind) => track(kind));
  return {
    loud,
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
    getTracks: () => tracks,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as LoudStream;
}

function peer(
  id: string,
  name: string,
  stream: MediaStream,
  media: { camera: boolean; mic: boolean },
): MeetRemotePeer {
  return {
    id,
    name,
    stream,
    connectionState: "connected",
    remoteMedia: media,
    disclosedMedia: media,
  };
}

function engagedStore(local: MediaStream): MeetCallStore {
  const store = createMeetCallStore();
  store.setStatus("in-call");
  store.setSelfId("self");
  store.setDisplayName("Demo User");
  store.setMicOn(true);
  store.setVideoOn(true);
  store.setStartedAt(Date.now());
  store.localStreamRef.current = local;
  return store;
}

async function renderMiniPlayer(store: MeetCallStore) {
  const rootRoute = createRootRoute({
    component: () => (
      <TooltipProvider>
        <MeetCallProvider store={store}>
          <Outlet />
        </MeetCallProvider>
      </TooltipProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: MeetCallMiniPlayer,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function previewVideo(): HTMLVideoElement | null {
  return document.querySelector(".meet-mini-player__video");
}

describe("MeetCallMiniPlayer active speaker", () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the remote peer who is talking instead of the local camera", async () => {
    installLoudAudioContext();
    const local = loudStream(["audio", "video"], false);
    const maya = loudStream(["audio", "video"], false);
    const felix = loudStream(["audio", "video"], true);
    const store = engagedStore(local);
    store.setPeers([
      peer("maya", "Maya Lindqvist", maya, { camera: true, mic: true }),
      peer("felix", "Felix Bauer", felix, { camera: true, mic: true }),
    ]);

    await renderMiniPlayer(store);

    await waitFor(() => {
      expect(previewVideo()?.srcObject).toBe(felix);
    });
    expect(previewVideo()?.classList.contains("meet-mini-player__video--mirrored")).toBe(true);
  });

  it("shows the local camera when the local user is the one talking", async () => {
    installLoudAudioContext();
    const local = loudStream(["audio", "video"], true);
    const felix = loudStream(["audio", "video"], false);
    const store = engagedStore(local);
    store.setPeers([peer("felix", "Felix Bauer", felix, { camera: true, mic: true })]);

    await renderMiniPlayer(store);

    await waitFor(() => {
      expect(previewVideo()?.srcObject).toBe(local);
    });
  });

  it("shows the talking peer's avatar when their camera is off", async () => {
    installLoudAudioContext();
    const local = loudStream(["audio", "video"], false);
    const felix = loudStream(["audio"], true);
    const store = engagedStore(local);
    store.setPeers([peer("felix", "Felix Bauer", felix, { camera: false, mic: true })]);

    await renderMiniPlayer(store);

    await waitFor(() => {
      expect(document.querySelector(".meet-mini-player__preview")?.textContent).toContain("FB");
    });
    expect(previewVideo()).toBeNull();
  });
});
