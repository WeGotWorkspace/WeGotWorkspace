import { describe, expect, it } from "vitest";
import { withOpusDtxAndFec } from "@/meet-core/src/meet-opus-fmtp";

const lines = (...rows: string[]) => `${rows.join("\r\n")}\r\n`;

describe("withOpusDtxAndFec", () => {
  it("adds usedtx and keeps the browser's own fmtp parameters", () => {
    const sdp = lines(
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=rtpmap:63 red/48000/2",
      "a=fmtp:63 111/111",
    );

    expect(withOpusDtxAndFec(sdp)).toBe(
      lines(
        "v=0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1",
        "a=rtpmap:63 red/48000/2",
        "a=fmtp:63 111/111",
      ),
    );
  });

  it("turns FEC and DTX on when the remote description switched them off", () => {
    const sdp = lines(
      "m=audio 9 UDP/TLS/RTP/SAVPF 109",
      "a=rtpmap:109 opus/48000/2",
      "a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=0;usedtx=0",
    );

    expect(withOpusDtxAndFec(sdp)).toContain(
      "a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1;usedtx=1\r\n",
    );
  });

  it("adds an fmtp line when the Opus payload type has none", () => {
    const sdp = lines("m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 OPUS/48000/2", "a=sendrecv");

    expect(withOpusDtxAndFec(sdp)).toBe(
      lines(
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "a=rtpmap:111 OPUS/48000/2",
        "a=fmtp:111 useinbandfec=1;usedtx=1",
        "a=sendrecv",
      ),
    );
  });

  it("follows the Opus payload type per media section", () => {
    const sdp = lines(
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10",
      "m=video 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 VP8/90000",
      "a=fmtp:111 max-fs=12288",
    );

    const out = withOpusDtxAndFec(sdp);
    expect(out).toContain("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n");
    expect(out).toContain("a=fmtp:111 max-fs=12288\r\n");
  });

  it("leaves a description without Opus unchanged", () => {
    const sdp = lines(
      "v=0",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "a=sctp-port:5000",
    );
    expect(withOpusDtxAndFec(sdp)).toBe(sdp);
  });
});
