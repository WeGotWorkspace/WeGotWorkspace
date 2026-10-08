export function parseCandidateType(candidate: string): string {
  const match = candidate.match(/\btyp\s+([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() ?? "unknown";
}

/** `o=` session id of an SDP, or null. It stays the same across ICE restarts of one peer connection. */
export function sdpSessionId(sdp: string | undefined | null): string | null {
  if (!sdp) return null;
  const match = /^o=\S+\s+(\S+)\s/m.exec(sdp);
  return match?.[1] ?? null;
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
  return { type: normalizedType, sdp: raw.sdp };
}

export function sanitizeSdpForInterop(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  const sdp = typeof desc.sdp === "string" ? desc.sdp : "";
  if (!sdp.includes("a=max-message-size:")) return desc;
  const filtered = sdp
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("a=max-message-size:"))
    .join("\r\n")
    .replace(/\r?\n?$/, "\r\n");
  return { ...desc, sdp: filtered };
}

export function rewriteSctpPortToLegacy(
  desc: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  const sdp = typeof desc.sdp === "string" ? desc.sdp : "";
  if (!sdp.includes("a=sctp-port:")) return desc;

  const lines = sdp.split(/\r?\n/);
  const out: string[] = [];
  let injectedSctpMap = false;

  for (const line of lines) {
    if (line.startsWith("a=sctp-port:")) {
      const port = line.split(":")[1] || "5000";
      out.push(`a=sctpmap:${port} webrtc-datachannel 1024`);
      injectedSctpMap = true;
      continue;
    }
    if (line.startsWith("m=application ") && line.includes(" webrtc-datachannel")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const maybePort = injectedSctpMap
          ? (out[out.length - 1]?.match(/^a:sctpmap:(\d+)/)?.[1] ?? "5000")
          : "5000";
        out.push(`m=application ${parts[1]} DTLS/SCTP ${maybePort}`);
        continue;
      }
    }
    out.push(line);
  }

  const rebuilt = out.join("\r\n").replace(/\r?\n?$/, "\r\n");
  return { ...desc, sdp: rebuilt };
}

export async function safeSetRemoteDescription(
  pc: RTCPeerConnection,
  desc: RTCSessionDescriptionInit,
): Promise<void> {
  try {
    await pc.setRemoteDescription(desc);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("invalid sdp line")) throw error;
    const sanitized = sanitizeSdpForInterop(desc);
    if (sanitized.sdp !== desc.sdp) {
      try {
        await pc.setRemoteDescription(sanitized);
        return;
      } catch {
        // Continue to legacy fallback below.
      }
    }
    const legacy = rewriteSctpPortToLegacy(sanitized);
    if (legacy.sdp === desc.sdp) throw error;
    await pc.setRemoteDescription(legacy);
  }
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
