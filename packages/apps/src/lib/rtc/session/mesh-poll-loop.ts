import {
  isUnchangedPollResponse,
  type HttpSignalingPollInput,
  type HttpSignalingPollResponse,
  type HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import {
  hasStableCollabTopology,
  isAnyPeerConnecting,
  steadyPollDelayMs,
  type MeshPollCadenceSnapshot,
} from "@/lib/rtc/session/poll-cadence";
import {
  pushHeartbeatCovers,
  pushHeartbeatIncludes,
  registerPushHeartbeatPeer,
} from "@/lib/rtc/session/push-heartbeat-peers";
import { signalMeetLane } from "@/lib/traffic/meet-lane-client";
import { pushRoomDoorbell, type RoomDoorbell } from "@/lib/rtc/session/room-doorbell";
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
  onPollRoundTrip?: (elapsedMs: number) => void;
  isVisible: () => boolean;
  log: (event: string, details?: unknown) => void;
  scheduleTimeout: typeof setTimeout;
  cancelTimeout: typeof clearTimeout;
  /**
   * The push doorbell (#2294). Undefined takes this browser's push hub; null turns it off,
   * so the room keeps its own cadence.
   */
  doorbell?: RoomDoorbell | null;
};

export class MeshPollLoop {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  private pollInFlight = false;

  private pendingKick = false;

  /** The armed timer is a non-steady (kicked or connecting) poll. */
  private kickedTimerPending = false;

  private lastLoggedPollDelayMs: number | null = null;

  /** Between the first schedule and `stop()` / `release()`: a ring may poll. */
  private running = false;

  private readonly doorbell: RoomDoorbell | null;

  private doorbellCleanup: (() => void) | null = null;

  /** This loop's peer as named on push reads (#2287), and its release. */
  private heartbeat: { peer: string; release: () => void } | null = null;

  constructor(private readonly context: MeshPollLoopContext) {
    this.doorbell = context.doorbell === undefined ? pushRoomDoorbell() : context.doorbell;
  }

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
    this.clearTimer();
    this.running = true;
    this.listenToDoorbell();
    const intervals = this.context.pollIntervals();
    const base = this.context.cadence();
    this.signalMeetLane(base, steady);
    const pushHeartbeat = this.doorbell !== null && this.holdHeartbeat(base.channel);
    const cadence = { ...base, doorbell: this.doorbell?.connected === true, pushHeartbeat };
    const delay = steady ? steadyPollDelayMs(intervals, cadence) : intervals.connectingMs;
    this.logDelay(delay, steady, cadence);
    this.kickedTimerPending = !steady;
    // No steady poll: push reads keep the peer alive; a ring or a status change wakes us.
    if (!Number.isFinite(delay)) return;
    this.pollTimer = this.context.scheduleTimeout(() => {
      void this.pollOnce()
        .catch((error: unknown) => this.handlePollError(error))
        .finally(() => this.schedule(!this.takeKick()));
    }, delay);
  }

  /** Poll as soon as possible. Deferred when a poll is already in flight, never dropped. */
  kick(): void {
    if (this.pollInFlight) {
      this.pendingKick = true;
      return;
    }
    this.schedule(false);
  }

  private takeKick(): boolean {
    const kicked = this.pendingKick;
    this.pendingKick = false;
    return kicked;
  }

  /**
   * Meet call setup lane (#2419): a Meet room tells the worker it is in a call
   * and, while a peer is still being dialled, that it is negotiating.
   */
  private signalMeetLane(base: MeshPollCadenceSnapshot, steady: boolean): void {
    if (base.channel !== "meet") return;
    signalMeetLane("call");
    if (!steady && isAnyPeerConnecting(base)) signalMeetLane("negotiating");
  }

  stop(): void {
    if (this.running && this.context.cadence().channel === "meet") signalMeetLane("left");
    this.running = false;
    this.clearTimer();
    this.dropHeartbeat();
  }

  /** Names this loop's current peer on push reads; true when push carries its heartbeat. */
  private holdHeartbeat(channel: MeshPollCadenceSnapshot["channel"]): boolean {
    const peerId = this.context.myId();
    if (!peerId || !pushHeartbeatCovers(channel)) {
      this.dropHeartbeat();
      return false;
    }
    const peer = `${channel}:${peerId}`;
    if (this.heartbeat?.peer !== peer) {
      this.dropHeartbeat();
      this.heartbeat = { peer, release: registerPushHeartbeatPeer(channel, peerId) };
    }
    // Past the header's cap the push read does not name this peer: keep polling.
    return pushHeartbeatIncludes(channel, peerId);
  }

  private dropHeartbeat(): void {
    this.heartbeat?.release();
    this.heartbeat = null;
  }

  private clearTimer(): void {
    if (this.pollTimer === null) return;
    this.context.cancelTimeout(this.pollTimer);
    this.pollTimer = null;
    this.kickedTimerPending = false;
  }

  /** Drop the in-flight guard, the logged delay and the doorbell so the next join polls cleanly. */
  release(): void {
    if (this.running && this.context.cadence().channel === "meet") signalMeetLane("left");
    this.running = false;
    this.pollInFlight = false;
    this.pendingKick = false;
    this.lastLoggedPollDelayMs = null;
    this.doorbellCleanup?.();
    this.doorbellCleanup = null;
    this.dropHeartbeat();
  }

  /**
   * A ring polls at once (a newcomer, a leaver or a message for this tab's peer); a status
   * change reschedules, so the heartbeat (or no poll at all, #2287) starts when push
   * connects and the room's own cadence comes back as soon as it drops.
   */
  private listenToDoorbell(): void {
    const doorbell = this.doorbell;
    if (!doorbell || this.doorbellCleanup) return;
    const unsubscribeRing = doorbell.subscribe(() => {
      if (!this.running) return;
      this.context.log("doorbell-ring");
      if (this.context.cadence().channel === "meet") signalMeetLane("negotiating");
      this.kick();
    });
    const unsubscribeStatus = doorbell.subscribeStatus(() => {
      // A kicked poll already armed must not slip to the heartbeat: the ring that arrives
      // with the response that connects push is delivered before the status change.
      if (this.running && !this.pollInFlight && !this.kickedTimerPending) this.schedule(true);
    });
    this.doorbellCleanup = () => {
      unsubscribeRing();
      unsubscribeStatus();
    };
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
    const started = Date.now();
    try {
      const data = await this.context.poll({ ...this.context.pollInput(), peerId });
      this.context.onPollRoundTrip?.(Math.max(0, Date.now() - started));
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
