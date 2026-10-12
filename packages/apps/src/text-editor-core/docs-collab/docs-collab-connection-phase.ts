/**
 * Connection work that usually finishes faster than a reader can notice. Showing
 * it immediately turns a healthy 400 ms reconnect into a flash of alarm, so these
 * phases stay hidden until they have lasted long enough to be worth mentioning.
 */
export type DocsCollabConnectionPhase = "connecting" | "reconnecting" | "rejoining";

export const CONNECTION_PHASE_REVEAL_MS = 1500;

const PHASE_BY_STATUS = new Map<string, DocsCollabConnectionPhase>([
  ["Connecting to collaborators…", "connecting"],
  ["Reconnecting…", "reconnecting"],
  ["Rejoining…", "rejoining"],
]);

/** Null for anything that is not a transient connection phase. */
export function docsCollabConnectionPhase(status: string): DocsCollabConnectionPhase | null {
  if (!status) return null;
  return PHASE_BY_STATUS.get(status) ?? null;
}

/**
 * The phase has to have been continuously active for the whole delay; any change
 * of phase resets `enteredAt` and starts the wait again.
 */
export function shouldRevealConnectionPhase(
  enteredAt: number | null,
  now: number,
  delayMs: number = CONNECTION_PHASE_REVEAL_MS,
): boolean {
  if (enteredAt === null) return false;
  return now - enteredAt >= delayMs;
}
