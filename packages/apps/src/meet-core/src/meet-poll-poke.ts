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
