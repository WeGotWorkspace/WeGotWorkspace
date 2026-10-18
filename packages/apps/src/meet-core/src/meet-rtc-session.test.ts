import { describe, expect, it, vi } from "vitest";
import type { CreateRtcSessionOptions } from "@/lib/rtc/session/create-rtc-session";
import { MeetRtcSession } from "@/meet-core/src/meet-rtc-session";
import { toSessionDescriptionPayload } from "@/lib/rtc/session/sdp";
import type { RtcSettings } from "@/lib/rtc/types";

const meshOptions = vi.hoisted(() => [] as CreateRtcSessionOptions[]);

vi.mock("@/lib/rtc/session/create-rtc-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtc/session/create-rtc-session")>();
  return {
    ...actual,
    createRtcSession: (options: CreateRtcSessionOptions) => {
      meshOptions.push(options);
      return actual.createRtcSession(options);
    },
  };
});

const RTC_SETTINGS: RtcSettings = {
  stunUrls: "",
  turnAvailable: false,
  forceRelay: false,
};

const REMOTE_OFFER_WITH_OPUS =
  "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n";

function guestSignalingFetch() {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/participants") && init.method === "POST") {
      return new Response(
        JSON.stringify({
          peerId: "GUESTPEER1",
          peers: [],
          sessionKey: "a".repeat(32),
        }),
        { status: 200 },
      );
    }
    if (url.includes("/events") && init.method === "GET") {
      return new Response(JSON.stringify({ peers: [], messages: [] }), { status: 200 });
    }
    if (url.includes("/participants/") && init.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  });
}

describe("MeetRtcSession SDP wiring", () => {
  it("applies an inbound description as received, like principal and collab", async () => {
    // Safari, Firefox and Chrome were measured against each other with video on
    // 2026-10-18 without the Meet SDP rewrite (#1345). Meet now uses the mesh default.
    const session = new MeetRtcSession({
      rtcSettings: RTC_SETTINGS,
      apiBase: "/api/v1/meet",
      fetchImpl: guestSignalingFetch(),
      getLocalStream: () => null,
    });
    await session.join({ room: "abcd-efgh-ijkl", peerId: "GUESTPEER1", name: "Guest" });

    const options = meshOptions.at(-1);
    expect(options?.channel).toBe("meet");
    const format = options?.formatInboundDescription ?? toSessionDescriptionPayload;
    const payload = { type: "offer", sdp: REMOTE_OFFER_WITH_OPUS };
    expect(format(payload, "offer")).toEqual(toSessionDescriptionPayload(payload, "offer"));

    await session.leave();
  });

  it("uses guest fetchImpl for signaling when provided", async () => {
    const fetchImpl = guestSignalingFetch();

    const session = new MeetRtcSession({
      rtcSettings: RTC_SETTINGS,
      apiBase: "/api/v1/meet",
      fetchImpl,
      getLocalStream: () => null,
    });

    const joined = await session.join({
      room: "abcd-efgh-ijkl",
      peerId: "GUESTPEER1",
      name: "Guest",
    });
    expect(joined.peerId).toBe("GUESTPEER1");
    expect(joined.sessionKey).toBe("a".repeat(32));
    expect(
      fetchImpl.mock.calls.some(
        ([url, init]) => url.includes("/participants") && init?.method === "POST",
      ),
    ).toBe(true);

    await session.leave();
  });
});
