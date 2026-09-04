import { afterEach, describe, expect, it, vi } from "vitest";
import { rtcLog, rtcSdpMeta } from "@/lib/rtc/log";
import { isRtcDebugEnabled } from "@/lib/rtc/debug";

vi.mock("@/lib/rtc/debug", () => ({
  isRtcDebugEnabled: vi.fn(),
}));

describe("rtcSdpMeta", () => {
  it("reports type and byte length without exposing the SDP", () => {
    const sdp = "v=0\r\n".repeat(20);
    expect(rtcSdpMeta({ type: "offer", sdp })).toEqual({
      sdpType: "offer",
      sdpBytes: sdp.length,
    });
  });
});

describe("rtcLog", () => {
  afterEach(() => {
    vi.mocked(isRtcDebugEnabled).mockReset();
    vi.restoreAllMocks();
  });

  it("does not touch console when the query flag is off", () => {
    vi.mocked(isRtcDebugEnabled).mockReturnValue(false);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    rtcLog({ channel: "collab" }, "join-request", { room: "docs/x.md" });
    expect(info).not.toHaveBeenCalled();
  });

  it("prints a one-line event with tMs and ISO wall clock when enabled", () => {
    vi.mocked(isRtcDebugEnabled).mockReturnValue(true);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    rtcLog({ channel: "collab", peerId: "aabbccdd" }, "offer-sent", { remoteId: "peer-b" });
    expect(info).toHaveBeenCalledTimes(1);
    const [prefix, payload] = info.mock.calls[0]!;
    expect(prefix).toBe("[rtc][collab][aabbccdd][offer-sent]");
    expect(payload).toEqual(
      expect.objectContaining({
        remoteId: "peer-b",
        tMs: expect.any(Number),
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
