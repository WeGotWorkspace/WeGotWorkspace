import {
  isUnchangedPollResponse,
  type HttpSignalingPollInput,
  type HttpSignalingPollResponse,
  type HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import {
  hasStableCollabTopology,
  steadyPollDelayMs,
  type MeshPollCadenceSnapshot,
} from "@/lib/rtc/session/poll-cadence";
import type { RtcPollIntervals } from "@/lib/rtc/types";

/**
 * Join/poll timer for one mesh. Kept off `RtcPeerMesh` so that file stays
 * under the 800-line ceiling.
 */
export type MeshPollLoopContext = {
  myId: () => string | null;
  poll: (input: HttpSignalingPollInput) => Promise<HttpSignalingPollResponse>;
  pollInput: () => Omit<HttpSignalingPollInput, "peerId">;
  setRosterSig: (sig: string | null) => void;
  onPoll: (data: HttpSignalingPollResult) => Promise<void>;
  pollIntervals: () => RtcPollIntervals;
  cadence: () => MeshPollCadenceSnapshot;
  shouldRecover: (error: unknown) => boolean;
  recover: () => Promise<void>;
  onPollError?: (error: unknown) => void;
  isVisible: () => boolean;
  log: (event: string, details?: unknown) => void;
  scheduleTimeout: typeof setTimeout;
  cancelTimeout: typeof clearTimeout;
};

export class MeshPollLoop {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  private pollInFlight = false;

  private lastLoggedPollDelayMs: number | null = null;

  constructor(private readonly context: MeshPollLoopContext) {}

  onVisibilityChange(): void {
    if (!this.context.myId()) return;
    if (this.context.isVisible()) {
      this.context.log("visibility-poll-restore");
      this.schedule(false);
      return;
    }
    // Reschedule so the hidden backoff (when applicable) kicks in without waiting a tick.
    this.schedule(true);
  }

  schedule(steady = false): void {
    if (!this.context.myId()) return;
    this.stop();
    const intervals = this.context.pollIntervals();
    const cadence = this.context.cadence();
    const delay = steady ? steadyPollDelayMs(intervals, cadence) : intervals.connectingMs;
    this.logDelay(delay, steady, cadence);
    this.pollTimer = this.context.scheduleTimeout(() => {
      void this.pollOnce()
        .catch((error: unknown) => this.handlePollError(error))
        .finally(() => this.schedule(true));
    }, delay);
  }

  stop(): void {
    if (this.pollTimer === null) return;
    this.context.cancelTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** Drop the in-flight guard and the logged delay so the next join polls cleanly. */
  release(): void {
    this.pollInFlight = false;
    this.lastLoggedPollDelayMs = null;
  }

  private logDelay(delay: number, steady: boolean, cadence: MeshPollCadenceSnapshot): void {
    if (this.lastLoggedPollDelayMs === delay) return;
    this.lastLoggedPollDelayMs = delay;
    this.context.log("poll-interval", {
      delayMs: delay,
      steady,
      connectingMs: this.context.pollIntervals().connectingMs,
      idleCollab: hasStableCollabTopology(cadence),
    });
  }

  private handlePollError(error: unknown): void {
    if (this.context.shouldRecover(error)) {
      void this.context.recover();
      return;
    }
    this.context.log("poll-failed", { error });
    this.context.onPollError?.(error);
  }

  private async pollOnce(): Promise<void> {
    const peerId = this.context.myId();
    if (!peerId || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const data = await this.context.poll({ ...this.context.pollInput(), peerId });
      if (isUnchangedPollResponse(data)) {
        this.context.log("poll-unchanged", { status: 204 });
        return;
      }
      this.context.log("poll-changed", { status: 200, peerCount: data.peers.length });
      this.context.setRosterSig(typeof data.rosterSig === "string" ? data.rosterSig : null);
      await this.context.onPoll(data);
    } finally {
      this.pollInFlight = false;
    }
  }
}
