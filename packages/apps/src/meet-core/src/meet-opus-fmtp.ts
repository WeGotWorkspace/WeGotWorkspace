import { toSessionDescriptionPayload } from "@/lib/rtc/session/sdp";

/**
 * Opus parameters Meet asks of every remote description it applies.
 *
 * An `a=fmtp` line in the remote description states what the remote side
 * wants to receive, so it configures this browser's own Opus encoder:
 * `usedtx=1` stops sending packets while the user is silent, and
 * `useinbandfec=1` keeps forward error correction on for lost packets.
 * In a call of six most people are silent most of the time, so DTX is
 * most of the audio uplink saved.
 *
 * Only the Opus `fmtp` line changes. Every other line, including the
 * browser's own Opus parameters, passes through as received (#1345, #1384).
 */
const OPUS_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ["useinbandfec", "1"],
  ["usedtx", "1"],
];

const RTPMAP_OPUS = /^a=rtpmap:(\d+) opus\/48000/i;
const FMTP = /^a=fmtp:(\d+) (.*)$/;

function withOpusParams(params: string): string {
  const entries = params
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  for (const [key, value] of OPUS_PARAMS) {
    const index = entries.findIndex((part) => part.split("=")[0]?.trim().toLowerCase() === key);
    if (index >= 0) entries[index] = `${key}=${value}`;
    else entries.push(`${key}=${value}`);
  }
  return entries.join(";");
}

function rewriteSection(rows: string[]): string[] {
  const opusTypes = new Set(
    rows.flatMap((row) => {
      const match = row.match(RTPMAP_OPUS);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  if (opusTypes.size === 0) return rows;

  const withFmtp = new Set<string>();
  const out = rows.map((row) => {
    const match = row.match(FMTP);
    if (!match?.[1] || !opusTypes.has(match[1])) return row;
    withFmtp.add(match[1]);
    return `a=fmtp:${match[1]} ${withOpusParams(match[2] ?? "")}`;
  });

  return out.flatMap((row) => {
    const match = row.match(RTPMAP_OPUS);
    if (!match?.[1] || withFmtp.has(match[1])) return [row];
    return [row, `a=fmtp:${match[1]} ${withOpusParams("")}`];
  });
}

/** Opus DTX and in-band FEC on every audio section. Expects CRLF line endings. */
export function withOpusDtxAndFec(sdp: string): string {
  const trailing = sdp.endsWith("\r\n");
  const rows = (trailing ? sdp.slice(0, -2) : sdp).split("\r\n");

  const sections: string[][] = [[]];
  for (const row of rows) {
    if (row.startsWith("m=")) sections.push([]);
    sections[sections.length - 1]?.push(row);
  }

  const out = sections.flatMap(rewriteSection).join("\r\n");
  return trailing ? `${out}\r\n` : out;
}

/** The mesh default (CRLF and terminator), then Opus DTX and FEC. */
export function formatMeetInboundDescription(
  payload: unknown,
  fallbackType: RTCSdpType,
): RTCSessionDescriptionInit | null {
  const desc = toSessionDescriptionPayload(payload, fallbackType);
  if (!desc?.sdp) return desc;
  return { ...desc, sdp: withOpusDtxAndFec(desc.sdp) };
}
