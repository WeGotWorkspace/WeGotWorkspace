import { WGW_MEET_LANE_MESSAGE, type MeetLaneSignal } from "@/lib/traffic/request-governor";

/**
 * Page side of the Meet signaling lane (#2419). It tells the service worker's
 * governor that a call is joining, negotiating, in progress or over, so Meet
 * room polls and the doorbell read skip the background queue for that short
 * while. A message costs no request; without a controlling worker it is a no-op.
 *
 * Repeats are throttled here: the worker's window is 30 s, so one signal every
 * few seconds keeps it open while a peer is being dialled.
 */
const MIN_GAP_MS: Record<MeetLaneSignal, number> = {
  join: 0,
  negotiating: 2_000,
  call: 10_000,
  left: 0,
};

const lastSent = new Map<MeetLaneSignal, number>();

export function signalMeetLane(signal: MeetLaneSignal, now: number = Date.now()): void {
  const last = lastSent.get(signal);
  if (last !== undefined && now - last < MIN_GAP_MS[signal]) return;
  const controller =
    typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : undefined;
  if (!controller) return;
  lastSent.set(signal, now);
  if (signal === "join" || signal === "left") lastSent.clear();
  try {
    controller.postMessage({ type: WGW_MEET_LANE_MESSAGE, signal });
  } catch {
    // A worker that went away costs only the lane.
  }
}
