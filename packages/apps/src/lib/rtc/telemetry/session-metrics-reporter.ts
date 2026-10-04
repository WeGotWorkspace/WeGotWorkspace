import { readSelectedPairSummary } from "@/lib/rtc/telemetry/selected-pair";
import type { NetClass } from "@/lib/rtc/net-probe";
import type { SignalingChannel } from "@/lib/rtc/types";

/** Wire channel for `POST /rtc/metrics`. Presence stays off this contract. */
export type MetricsChannel = "meet" | "collab";

const CANDIDATE_TYPES = new Set(["host", "srflx", "prflx", "relay"]);
const NET_CLASSES = new Set<NetClass>(["open", "symmetric", "udp-blocked", "unknown"]);

export const SESSION_METRICS_MIN_INTERVAL_MS = 60_000;

export type SessionMetricPost = (
  body: Record<string, unknown>,
  sessionKey: string | null,
) => Promise<void>;

export type SessionMetricsReporterOptions = {
  channel: SignalingChannel;
  /** Absent when the signaling client cannot post, so tests that stub it stay quiet. */
  post?: SessionMetricPost;
  sessionKey: () => string | null;
  net: () => NetClass | undefined;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (id: ReturnType<typeof setTimeout>) => void;
  minIntervalMs?: number;
};

/**
 * One anonymous sample per session, at most one request a minute.
 * The body is the contract allow-list: no room name, address, or user id.
 */
export class SessionMetricsReporter {
  private readonly reportChannel: MetricsChannel | null;

  private readonly post: SessionMetricPost | undefined;

  private readonly sessionKey: () => string | null;

  private readonly net: () => NetClass | undefined;

  private readonly now: () => number;

  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;

  private readonly cancel: (id: ReturnType<typeof setTimeout>) => void;

  private readonly minIntervalMs: number;

  private joinedAt: number | null = null;

  private connectedAt: number | null = null;

  private candidateType = "";

  private failedPairs = 0;

  private iceRestarts = 0;

  private httpFallback = false;

  private readonly pollSamples: number[] = [];

  private lastSentAt = 0;

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SessionMetricsReporterOptions) {
    this.reportChannel =
      options.channel === "meet" || options.channel === "collab" ? options.channel : null;
    this.post = options.post;
    this.sessionKey = options.sessionKey;
    this.net = options.net;
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel ?? ((id) => clearTimeout(id));
    this.minIntervalMs = options.minIntervalMs ?? SESSION_METRICS_MIN_INTERVAL_MS;
  }

  begin(): void {
    if (!this.active() || this.joinedAt !== null) return;
    this.joinedAt = this.now();
  }

  async noteConnected(pc: RTCPeerConnection): Promise<void> {
    if (!this.active()) return;
    if (this.connectedAt === null) this.connectedAt = this.now();
    try {
      const summary = await readSelectedPairSummary(pc);
      const type = summary?.localType;
      if (type && CANDIDATE_TYPES.has(type) && this.candidateType !== "relay") {
        this.candidateType = type;
      }
    } catch {
      // Stats are optional. Counters still go out on the next sample.
    }
    this.arm();
  }

  noteFailedPair(): void {
    if (!this.active()) return;
    this.failedPairs += 1;
    this.arm();
  }

  noteIceRestart(): void {
    if (!this.active()) return;
    this.iceRestarts += 1;
    this.arm();
  }

  /** Docs fell back to saving over HTTP after a direct peer could not connect. */
  noteHttpFallback(): void {
    if (!this.active()) return;
    this.httpFallback = true;
    this.arm();
  }

  notePollRtt(elapsedMs: number): void {
    if (!this.active() || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    this.pollSamples.push(Math.round(elapsedMs));
    if (this.pollSamples.length > 120) this.pollSamples.shift();
    this.arm();
  }

  /** Send now when the minute allows it. A leave during the quiet minute waits. */
  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (!this.active()) return;
    if (this.lastSentAt !== 0 && this.now() - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = this.now();
    const body = this.snapshot();
    const sessionKey = this.sessionKey();
    void this.post?.(body, sessionKey).catch(() => undefined);
  }

  private active(): boolean {
    return this.reportChannel !== null && this.post !== undefined;
  }

  private arm(): void {
    if (!this.active() || this.timer !== null) return;
    const wait = Math.max(0, this.minIntervalMs - (this.now() - this.lastSentAt));
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  private snapshot(): Record<string, unknown> {
    const body: Record<string, unknown> = { channel: this.reportChannel };
    if (this.joinedAt !== null && this.connectedAt !== null) {
      body.joinMs = Math.max(0, Math.min(600_000, this.connectedAt - this.joinedAt));
    }
    if (this.candidateType) body.candidateType = this.candidateType;
    body.failedPairs = this.failedPairs;
    body.iceRestarts = this.iceRestarts;
    body.httpFallback = this.httpFallback;
    if (this.pollSamples.length > 0) body.pollRttMs = median(this.pollSamples);
    const net = this.net();
    if (net && NET_CLASSES.has(net)) body.net = net;
    return body;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}
