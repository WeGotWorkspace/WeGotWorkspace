export type MeetKnockAdmissionStatus = "idle" | "preparing" | "waiting" | "in-call" | "failed";

export type CompleteMeetKnockAdmissionInput = {
  waiting: boolean;
  roomCode: string | null;
  selfPeerId: string | null;
  displayName: string;
  updateJoinName?: (name: string) => Promise<void>;
  setWaitingForAdmission: (value: boolean) => void;
  setStatus: (status: MeetKnockAdmissionStatus) => void;
  setStartedAt: (value: number) => void;
  onAdmitted?: () => void;
  /** Dial room peers after the knocker-side wait drops (same-peer rename). */
  onRtcReady?: () => void;
};

/**
 * Host admit (chunk H): drop the knocker-side wait UI immediately, then
 * rename-rejoin so the peer is no longer on the knock path. The rejoin is
 * best-effort — a hung or failed `updateJoinName` must not leave “Asking to
 * join” on screen after the host has already let them in.
 */
export async function completeMeetKnockAdmission(
  input: CompleteMeetKnockAdmissionInput,
): Promise<boolean> {
  if (!input.waiting || !input.roomCode || !input.selfPeerId) return false;
  input.setWaitingForAdmission(false);
  input.setStatus("in-call");
  input.setStartedAt(Date.now());
  input.onAdmitted?.();
  try {
    await input.updateJoinName?.(input.displayName.trim() || "Guest");
  } catch {
    // Already in the call chrome; signaling recorded the admit independently.
  }
  input.onRtcReady?.();
  return true;
}
