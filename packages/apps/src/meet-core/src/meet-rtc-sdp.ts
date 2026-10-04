/**
 * Normalize an inbound remote description before setRemoteDescription.
 *
 * The pair that required stripping is Safari (WebKit) against Chromium:
 * - Safari parsing a Chromium description drops RTX and Opus RED.
 * - Chromium parsing a Safari description drops `a=extmap-allow-mixed`,
 *   `a=rtcp-rsize`, and plan-b `a=ssrc` / `a=ssrc-group`.
 * H.265/HEVC, AV1, and VP9 are stripped for every parser. RTX and Opus RED
 * stay for everyone else. `usedtx=1` is added to the inbound Opus fmtp only;
 * outbound descriptions are not passed through this function.
 */

export type SdpParser = "chromium" | "safari" | "other";

/** WebKit Safari, excluding Chrome, Chromium, CriOS, and Edge. */
export function detectSdpParser(userAgent?: string): SdpParser {
  const ua = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const isWebKitSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua);
  if (isWebKitSafari) return "safari";
  if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua)) return "chromium";
  return "other";
}

function isAuxiliaryRtpCodec(codec: string): boolean {
  return (
    /^ulpfec\//i.test(codec) ||
    /^red\//i.test(codec) ||
    /^rtx\//i.test(codec) ||
    /^flexfec/i.test(codec)
  );
}

function isUnsupportedNegotiationCodec(codec: string): boolean {
  return (
    /^H265\//i.test(codec) ||
    /^HEVC\//i.test(codec) ||
    /^AV1\//i.test(codec) ||
    /^VP9\//i.test(codec)
  );
}

/** H.265/HEVC fmtp; do not match H.264 `profile-level-id`. */
function isH265FmtpParams(params: string): boolean {
  return /(?:^|;)level-id=\d+\b/.test(params) && /(?:^|;)profile-id=\d+\b/.test(params);
}

function isAv1FmtpParams(params: string): boolean {
  return /(?:^|;)level-idx=\d+\b/.test(params);
}

function isRejectedSessionAttribute(line: string): boolean {
  return (
    line === "a=rtcp-rsize" ||
    line.startsWith("a=rtcp-rsize ") ||
    line === "a=extmap-allow-mixed" ||
    line.startsWith("a=extmap-allow-mixed ")
  );
}

function buildCodecByPayloadType(lines: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of lines) {
    const rtpmap = line.match(/^a=rtpmap:(\d+)\s+(\S+)/);
    if (rtpmap) {
      map.set(Number(rtpmap[1]), rtpmap[2]!);
    }
  }
  return map;
}

function rewriteFmtpLine(line: string, codecByPt: ReadonlyMap<number, string>): string | null {
  const match = line.match(/^a=fmtp:(\d+)\s+(.+)$/);
  if (!match) {
    return line;
  }
  const pt = Number(match[1]);
  const params = match[2]!;
  const codec = codecByPt.get(pt) ?? "";

  const apt = params.match(/(?:^|;)apt=(\d+)\b/)?.[1];
  if (apt) {
    return `a=fmtp:${pt} apt=${apt}`;
  }

  const profileLevelId = params.match(/profile-level-id=([0-9a-fA-F]{6})/i)?.[1];
  if (profileLevelId) {
    const packetizationMode = params.match(/packetization-mode=([01])/i)?.[1] ?? "1";
    return `a=fmtp:${pt} packetization-mode=${packetizationMode};profile-level-id=${profileLevelId.toLowerCase()}`;
  }

  if (isH265FmtpParams(params) || isUnsupportedNegotiationCodec(codec)) {
    return null;
  }

  return line;
}

function withOpusUsedtx(lines: string[], codecByPt: ReadonlyMap<number, string>): string[] {
  let opusPt: number | null = null;
  for (const [pt, codec] of codecByPt) {
    if (/^opus\//i.test(codec)) opusPt = pt;
  }
  if (opusPt === null) return lines;
  let seen = false;
  const rewritten = lines.map((line) => {
    const match = line.match(new RegExp(`^a=fmtp:${opusPt}\\s+(.+)$`));
    if (!match) return line;
    seen = true;
    return /(?:^|;)usedtx=1\b/.test(match[1]!) ? line : `a=fmtp:${opusPt} ${match[1]};usedtx=1`;
  });
  if (seen) return rewritten;
  const inserted: string[] = [];
  for (const line of rewritten) {
    inserted.push(line);
    if (line.startsWith(`a=rtpmap:${opusPt} `)) inserted.push(`a=fmtp:${opusPt} usedtx=1`);
  }
  return inserted;
}

export function sanitizeRtcSdp(sdp: string, parser: SdpParser = detectSdpParser()): string {
  const usesCrLf = sdp.includes("\r\n");
  const lines = sdp.replace(/\r\n/g, "\n").split("\n");
  const codecByPt = buildCodecByPayloadType(lines);
  const dropPayloadTypes = new Set<number>();

  for (const line of lines) {
    const rtpmap = line.match(/^a=rtpmap:(\d+)\s+(\S+)/);
    if (rtpmap) {
      const pt = Number(rtpmap[1]);
      const codec = rtpmap[2]!;
      const auxiliary = parser === "safari" && isAuxiliaryRtpCodec(codec);
      if (auxiliary || isUnsupportedNegotiationCodec(codec)) {
        dropPayloadTypes.add(pt);
      }
    }
    const fmtp = line.match(/^a=fmtp:(\d+)\s+(.+)/);
    if (!fmtp) {
      continue;
    }
    const pt = Number(fmtp[1]);
    const params = fmtp[2]!;
    if (parser === "safari" && /(?:^|;)apt=\d+\b/.test(params)) {
      dropPayloadTypes.add(pt);
    }
    if (isH265FmtpParams(params) || isAv1FmtpParams(params)) {
      dropPayloadTypes.add(pt);
    }
  }

  const filtered = lines
    .map((line) => (line.startsWith("a=fmtp:") ? rewriteFmtpLine(line, codecByPt) : line))
    .filter((line): line is string => {
      if (line === null || line === "") {
        return false;
      }
      if (parser === "chromium" && isRejectedSessionAttribute(line)) {
        return false;
      }
      if (
        parser === "chromium" &&
        (line.startsWith("a=ssrc:") || line.startsWith("a=ssrc-group:"))
      ) {
        return false;
      }
      const rtpmap = line.match(/^a=rtpmap:(\d+)\s+/);
      if (rtpmap && dropPayloadTypes.has(Number(rtpmap[1]))) {
        return false;
      }
      const fmtp = line.match(/^a=fmtp:(\d+)\s+/);
      if (fmtp && dropPayloadTypes.has(Number(fmtp[1]))) {
        return false;
      }
      const rtcpFb = line.match(/^a=rtcp-fb:(\d+)\s+/);
      if (rtcpFb && dropPayloadTypes.has(Number(rtcpFb[1]))) {
        return false;
      }
      return true;
    });

  const cleaned = filtered
    .map((line) => {
      if (!line.startsWith("m=")) {
        return line;
      }
      const tokens = line.split(" ");
      if (tokens.length <= 3) {
        return line;
      }
      const payloads = tokens.slice(3).filter((pt) => !dropPayloadTypes.has(Number(pt)));
      if (payloads.length === 0) {
        return null;
      }
      return [...tokens.slice(0, 3), ...payloads].join(" ");
    })
    .filter((line): line is string => line !== null);

  let out = withOpusUsedtx(cleaned, codecByPt).join("\n");
  if (!out.endsWith("\n")) {
    out += "\n";
  }
  return usesCrLf ? out.replace(/\n/g, "\r\n") : out;
}
