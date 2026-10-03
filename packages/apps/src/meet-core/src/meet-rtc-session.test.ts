import { describe, expect, it, vi } from "vitest";
import { MeetRtcSession } from "@/meet-core/src/meet-rtc-session";
import { sanitizeRtcSdp } from "@/meet-core/src/meet-rtc-sdp";
import { toSessionDescriptionPayload } from "@/lib/rtc/session/sdp";
import type { RtcSettings } from "@/lib/rtc/types";

const RTC_SETTINGS: RtcSettings = {
  stunUrls: "",
  turnAvailable: false,
  forceRelay: false,
};

const REMOTE_OFFER_WITH_SSRC =
  "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ssrc:5555 cname:remote\r\na=rtcp-rsize\r\n";

describe("MeetRtcSession SDP wiring", () => {
  it("sanitizes inbound remote descriptions only", () => {
    const inbound = toSessionDescriptionPayload(
      { type: "offer", sdp: REMOTE_OFFER_WITH_SSRC },
      "offer",
    );
    expect(inbound?.sdp).toBeDefined();
    const sanitized = sanitizeRtcSdp(inbound!.sdp!);
    expect(sanitized).not.toContain("a=ssrc:");
    expect(sanitized).not.toContain("a=rtcp-rsize");
  });

  it("uses guest fetchImpl for signaling when provided", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
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
