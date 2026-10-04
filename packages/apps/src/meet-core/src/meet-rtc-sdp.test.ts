import { describe, expect, it } from "vitest";
import { sanitizeRtcSdp } from "@/meet-core/src/meet-rtc-sdp";

const SAMPLE = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=rtpmap:63 red/48000/2",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 49 45",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:96 VP8/90000",
  "a=rtpmap:97 rtx/90000",
  "a=fmtp:97 apt=96",
  "a=rtpmap:98 H264/90000",
  "a=fmtp:98 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f",
  "a=rtpmap:49 H265/90000",
  "a=fmtp:49 level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST",
  "a=rtpmap:45 AV1/90000",
  "a=fmtp:45 level-idx=5;profile=0;tier=0",
  "a=ssrc:1047663390 msid:abc def",
  "a=rtcp-rsize",
  "a=extmap-allow-mixed",
].join("\n");

describe("sanitizeRtcSdp", () => {
  it("strips Safari session lines when Chromium parses the description", () => {
    const out = sanitizeRtcSdp(SAMPLE, "chromium");
    expect(out).toContain("a=rtpmap:111 opus/48000/2");
    expect(out).toContain("a=rtpmap:63 red/48000/2");
    expect(out).toContain("a=rtpmap:97 rtx/90000");
    expect(out).toContain("a=rtpmap:96 VP8/90000");
    expect(out).toContain("a=fmtp:98 packetization-mode=1;profile-level-id=64001f");
    expect(out).toContain("a=fmtp:111 usedtx=1");
    expect(out).not.toContain("H265");
    expect(out).not.toContain("AV1");
    expect(out).not.toContain("a=ssrc:");
    expect(out).not.toContain("a=rtcp-rsize");
    expect(out).not.toContain("extmap-allow-mixed");
  });

  it("strips RTX and Opus RED when Safari parses a Chromium description", () => {
    const out = sanitizeRtcSdp(SAMPLE, "safari");
    expect(out).toContain("a=rtpmap:111 opus/48000/2");
    expect(out).toContain("a=ssrc:");
    expect(out).toContain("a=rtcp-rsize");
    expect(out).toContain("extmap-allow-mixed");
    expect(out).not.toContain("a=rtpmap:63 red/48000/2");
    expect(out).not.toContain("a=rtpmap:97 rtx/90000");
    expect(out).not.toContain("H265");
    expect(out).not.toContain("AV1");
  });

  it("drops retransmission payloads that point at a removed codec", () => {
    const offer = [
      "m=video 9 UDP/TLS/RTP/SAVPF 96 97 45 46",
      "a=mid:1",
      "a=rtpmap:96 VP8/90000",
      "a=rtpmap:97 rtx/90000",
      "a=fmtp:97 apt=96",
      "a=rtpmap:45 AV1/90000",
      "a=fmtp:45 level-idx=5;profile=0;tier=0",
      "a=rtpmap:46 rtx/90000",
      "a=fmtp:46 apt=45",
    ].join("\n");
    const out = sanitizeRtcSdp(offer, "chromium");
    expect(out).toContain("a=rtpmap:97 rtx/90000");
    expect(out).toContain("a=fmtp:97 apt=96");
    expect(out).not.toContain("AV1");
    expect(out).not.toContain("apt=45");
    expect(out).not.toContain("a=rtpmap:46");
    expect(out).toContain("m=video 9 UDP/TLS/RTP/SAVPF 96 97");
  });

  it("keeps ssrc lines on a unified-plan offer Chromium is parsing", () => {
    const unified = [
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=mid:1",
      "a=ssrc:1047663390 msid:abc def",
    ].join("\n");
    const out = sanitizeRtcSdp(unified, "chromium");
    expect(out).toContain("a=ssrc:1047663390 msid:abc def");
    expect(out).toContain("a=mid:1");
  });

  it("keeps RTX, RED, and Safari session lines for any other parser", () => {
    const out = sanitizeRtcSdp(SAMPLE, "other");
    expect(out).toContain("a=rtpmap:97 rtx/90000");
    expect(out).toContain("a=rtpmap:63 red/48000/2");
    expect(out).toContain("a=ssrc:");
    expect(out).toContain("a=rtcp-rsize");
    expect(out).not.toContain("H265");
    expect(out).not.toContain("VP9");
  });
});
