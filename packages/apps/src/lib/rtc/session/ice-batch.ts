import type { RtcPeerCap } from "@/lib/rtc/types";

/** How long trickle candidates wait before one ice message leaves. */
export const ICE_BATCH_MS = 150;

function isIceCandidate(value: unknown): value is RTCIceCandidateInit {
  if (!value || typeof value !== "object") return false;
  const candidate = (value as { candidate?: unknown }).candidate;
  return typeof candidate === "string" && candidate.trim() !== "";
}

/**
 * One candidate object, `{candidates: [...]}`, or a bare array. Old senders
 * still trickle one object; `ice-batch` peers send the object with an array.
 */
export function icePayloadCandidates(payload: unknown): RTCIceCandidateInit[] {
  if (Array.isArray(payload)) return payload.filter(isIceCandidate);
  if (payload && typeof payload === "object" && "candidates" in payload) {
    const list = (payload as { candidates?: unknown }).candidates;
    if (Array.isArray(list)) return list.filter(isIceCandidate);
  }
  return isIceCandidate(payload) ? [payload] : [];
}

export function peerAcceptsIceBatch(caps: readonly RtcPeerCap[] | undefined): boolean {
  return caps?.includes("ice-batch") === true;
}

type Batch = {
  timer: ReturnType<typeof setTimeout> | null;
  items: RTCIceCandidateInit[];
};

/**
 * Collects local candidates per remote peer. Peers that advertised `ice-batch`
 * get one `{candidates}` message per window; everyone else is trickled as today.
 */
export class IceOutbound {
  private readonly batches = new Map<string, Batch>();

  constructor(
    private readonly options: {
      delayMs?: number;
      acceptsBatch: (remoteId: string) => boolean;
      send: (remoteId: string, payload: unknown) => void;
      schedule?: typeof setTimeout;
      cancel?: typeof clearTimeout;
    },
  ) {}

  note(remoteId: string, candidate: RTCIceCandidateInit): void {
    if (!this.options.acceptsBatch(remoteId)) {
      this.options.send(remoteId, candidate);
      return;
    }
    const batch = this.batches.get(remoteId) ?? { timer: null, items: [] };
    batch.items.push(candidate);
    this.batches.set(remoteId, batch);
    if (batch.timer !== null) return;
    const schedule = this.options.schedule ?? setTimeout.bind(globalThis);
    batch.timer = schedule(() => this.flush(remoteId), this.options.delayMs ?? ICE_BATCH_MS);
  }

  drop(remoteId: string): void {
    const batch = this.batches.get(remoteId);
    if (!batch) return;
    if (batch.timer !== null) {
      (this.options.cancel ?? clearTimeout.bind(globalThis))(batch.timer);
    }
    this.batches.delete(remoteId);
  }

  dispose(): void {
    for (const remoteId of [...this.batches.keys()]) this.drop(remoteId);
  }

  private flush(remoteId: string): void {
    const batch = this.batches.get(remoteId);
    if (!batch) return;
    batch.timer = null;
    const items = batch.items.splice(0);
    if (items.length === 0) return;
    this.options.send(remoteId, { candidates: items });
  }
}
