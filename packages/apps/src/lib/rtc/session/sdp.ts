export function parseCandidateType(candidate: string): string {
  const match = candidate.match(/\btyp\s+([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() ?? "unknown";
}

export function parseCandidateProtocol(candidate: string): string {
  const parts = candidate.trim().split(/\s+/);
  return parts[2]?.toLowerCase() ?? "unknown";
}

export function toSessionDescriptionPayload(
  payload: unknown,
  fallbackType: RTCSdpType,
): RTCSessionDescriptionInit | null {
  const raw = payload as { sdp?: unknown; type?: unknown } | null;
  if (!raw || typeof raw.sdp !== "string" || raw.sdp.trim() === "") return null;
  const type = raw.type;
  const normalizedType: RTCSdpType =
    type === "offer" || type === "answer" || type === "pranswer" || type === "rollback"
      ? type
      : fallbackType;
  return { type: normalizedType, sdp: normalizeSdpTerminator(raw.sdp) };
}

/** CRLF endings and a trailing CRLF. Chrome rejects a Firefox offer that lacks the terminator. */
export function normalizeSdpTerminator(sdp: string): string {
  const crlf = sdp.replace(/\r\n|\r|\n/g, "\r\n");
  return crlf.endsWith("\r\n") ? crlf : `${crlf}\r\n`;
}

export async function safeSetRemoteDescription(
  pc: RTCPeerConnection,
  desc: RTCSessionDescriptionInit,
): Promise<void> {
  await pc.setRemoteDescription(desc);
}

export async function flushPendingIce(
  pc: RTCPeerConnection,
  pendingIce: RTCIceCandidateInit[],
): Promise<void> {
  while (pendingIce.length > 0) {
    const candidate = pendingIce.shift();
    if (!candidate) continue;
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Ignore invalid queued candidates.
    }
  }
}
