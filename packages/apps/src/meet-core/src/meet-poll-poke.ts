import { isMeetDcPoke } from "@/lib/rtc/session/meet-data-channel";

/** A remote peer may move our poll forward at most this often. */
export const MEET_POKE_MIN_INTERVAL_MS = 1000;

export type MeetPokeGate = { allow: () => boolean };

/** One gate per call session. Shared across peers: the cap is global, not per peer. */
export function createMeetPokeGate(now: () => number = Date.now): MeetPokeGate {
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    allow(): boolean {
      const ts = now();
      if (ts - lastAt < MEET_POKE_MIN_INTERVAL_MS) return false;
      lastAt = ts;
      return true;
    },
  };
}

export type HandleMeetDataFrameArgs = {
  raw: string;
  gate: MeetPokeGate;
  onKick: () => void;
  onChat: (raw: string) => void;
};

/**
 * Route one Meet data-channel payload: poke → gated poll kick; otherwise chat.
 * Pokes never reach `onChat`.
 */
export function handleMeetDataFrame({ raw, gate, onKick, onChat }: HandleMeetDataFrameArgs): void {
  if (isMeetDcPoke(raw)) {
    if (gate.allow()) onKick();
    return;
  }
  onChat(raw);
}
