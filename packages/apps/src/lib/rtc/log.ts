import type { SignalingChannel } from "@/lib/rtc/types";
import { isRtcDebugEnabled } from "@/lib/rtc/debug";

export type RtcLogContext = {
  channel: SignalingChannel;
  peerId?: string | null;
};

function timestamp(): { tMs: number; at: string } {
  const tMs = typeof performance !== "undefined" ? Math.round(performance.now()) : 0;
  return { tMs, at: new Date().toISOString() };
}

/** SDP type + byte length only — never log the SDP blob. */
export function rtcSdpMeta(payload: unknown): { sdpType?: string; sdpBytes: number } {
  if (!payload || typeof payload !== "object") return { sdpBytes: 0 };
  const record = payload as { type?: unknown; sdp?: unknown };
  return {
    sdpType: typeof record.type === "string" ? record.type : undefined,
    sdpBytes: typeof record.sdp === "string" ? record.sdp.length : 0,
  };
}

export function rtcLog(context: RtcLogContext, event: string, details?: unknown): void {
  if (!isRtcDebugEnabled()) return;
  const peer = context.peerId ? `[${context.peerId}]` : "";
  const prefix = `[rtc][${context.channel}]${peer}[${event}]`;
  const stamp = timestamp();
  if (details === undefined) {
    console.info(prefix, stamp);
    return;
  }
  if (details !== null && typeof details === "object") {
    console.info(prefix, { ...stamp, ...(details as Record<string, unknown>) });
    return;
  }
  console.info(prefix, { ...stamp, details });
}
