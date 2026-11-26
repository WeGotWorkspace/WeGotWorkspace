/**
 * Browser-wide traffic governor for the suite's own API (shared hosting
 * traffic budget, #2291). It runs in the service worker, the one place every
 * tab's requests pass through, and only looks at same-origin `/api/v1/…`:
 *
 * - **Coalesce:** `settings/state`, `me` and `jmap/session` reads of one
 *   signed-in session share one request and one answer for a short while,
 *   however many apps and tabs ask at start-up.
 * - **Background:** polls (signaling, the push stream, `…/changes`,
 *   notification lists, or anything marked `X-WGW-Traffic: background`) draw
 *   from a token bucket. With an empty bucket the request waits (never longer
 *   than `maxWaitMs`), so the whole browser slows down to the budget.
 * - **Bulk:** first downloads and prefetch marked `X-WGW-Traffic: bulk` go one
 *   at a time at their own pace, never in a burst.
 * - **Shared brake:** a network failure, 429 or 503 holds background and bulk
 *   requests (2 s doubling to 60 s, or the server's `Retry-After`).
 * - **Meet lane (#2419):** while a Meet call is joining or negotiating, the
 *   room polls of a Meet room and the push doorbell read skip the background
 *   queue (see `MEET_LANE`). The page opens the lane with a message; it closes
 *   by itself, is capped by its own small bucket, charges the background
 *   bucket (so the average stays at the budget) and never covers other traffic.
 * - **Everything else** (foreground reads, writes) is never delayed and never
 *   uses the background bucket: a busy download must not starve the push
 *   doorbell, because a silent doorbell makes the apps poll on their own.
 *
 * The numbers come from the server (`X-WGW-Traffic-Budget`, one client build
 * serves every install channel). Until the first answer carrying the header the
 * strict shared-hosting defaults hold, and 0 turns pacing off.
 *
 * This is politeness toward the host's per-IP firewall, not a security
 * boundary: a page can only ever get *slower* by marking its own requests,
 * because unmarked requests are the fast path. The budget header is trusted
 * only from a same-origin answer and is clamped to 0–10000, so the worst a
 * forged one does is turn pacing off for this browser, which is the state
 * of any browser without the worker.
 */

export type GovernorClass = "coalesce" | "background" | "bulk" | "foreground" | "write";

/**
 * A client marks work nobody waits for with this header: `bulk` for first
 * downloads and offline prefetch, `background` for polls the path rules miss.
 * It is the only way a write-shaped request (a JMAP read is a POST) is
 * governed; unmarked writes always go straight through. Mark only work that
 * does not depend on its order against other writes: a marked request can
 * wait behind the budget while an unmarked one passes.
 */
export const TRAFFIC_CLASS_HEADER = "X-WGW-Traffic";

const COALESCE_PATHS = [/\/settings\/state$/, /\/me$/, /\/jmap\/session$/];

const BACKGROUND_PATHS = [/\/rooms\/[^/]+\/events$/, /\/jmap\/events\//, /\/changes$/];

/**
 * A Meet room's mailbox poll. Collab file rooms (`f_…`) and principal presence
 * rooms (`p_…`) share the route but never ride the lane (`lib/rtc/room-id.ts`).
 */
const MEET_ROOM_POLL = /\/rooms\/(?!p_|f_)[^/]+\/events$/;
const DOORBELL_READ = /\/jmap\/events\//;

/** Message a page posts to the worker to open, keep or close the Meet lane. */
export const WGW_MEET_LANE_MESSAGE = "wgw-meet-lane";

/**
 * `join`: a Meet join starts (opens the window, re-arms the guest burst).
 * `negotiating`: a peer is being dialled or a ring arrived (extends the window).
 * `call`: this browser is in a Meet room (the doorbell read may skip the queue, the room polls may not).
 * `left`: the call ended (closes everything).
 */
export type MeetLaneSignal = "join" | "negotiating" | "call" | "left";

export function isMeetLaneSignal(value: unknown): value is MeetLaneSignal {
  return value === "join" || value === "negotiating" || value === "call" || value === "left";
}

/**
 * The Meet signaling lane. Worst case per browser and opening: `burst` plus
 * `perMinute` over `maxOpenMs` = 10 + 20 × 0.75 = 25 lane polls (a guest 10 more).
 * A member's are charged to the background bucket and stop at half a burst of
 * debt, so the governed total in any minute stays under 30 + 10 + 5 = 45.
 */
export const MEET_LANE = {
  /** The lane stays open this long after the last `join` / `negotiating` signal. */
  windowMs: 30_000,
  /** … but never longer than this after it opened, however often the page signals. */
  maxOpenMs: 45_000,
  /** The doorbell read may skip the queue this long after the last `call` signal (the page re-sends). */
  callTtlMs: 45_000,
  /** Lane polls that may go at once. */
  burst: 10,
  /** Sustained lane polls per minute. */
  perMinute: 20,
  /** Extra polls an unauthenticated guest gets once per join (they have no push stream). */
  guestBonus: 10,
} as const;

/** `null` for anything that is not the suite's own API: the governor never touches it. */
export function classifyRequest(
  method: string,
  url: URL,
  apiPrefix = "/api/v1",
  marker: string | null = null,
): GovernorClass | null {
  if (!url.pathname.startsWith(`${apiPrefix}/`)) return null;
  const mark = marker?.trim().toLowerCase();
  if (mark === "bulk" || mark === "background") return mark;
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return "write";
  if (verb === "HEAD") return "foreground";
  const path = url.pathname;
  if (COALESCE_PATHS.some((pattern) => pattern.test(path))) return "coalesce";
  // Only the inbox poll: `calendars/scheduling/notifications` is a list the user waits for.
  if (path === `${apiPrefix}/notifications`) return "background";
  if (BACKGROUND_PATHS.some((pattern) => pattern.test(path))) return "background";
  return "foreground";
}

/** The classes the worker answers itself; the rest go on natively. */
export function isGovernedClass(kind: GovernorClass): boolean {
  return kind === "coalesce" || kind === "background" || kind === "bulk";
}

export type GovernorOptions = {
  /** Sustained background requests per minute for the whole browser. 0 = unpaced. */
  backgroundPerMinute: number;
  /** Background requests that may go at once after a quiet spell. */
  burst: number;
  /** How long a coalesced answer is reused. */
  coalesceTtlMs: number;
  /** Sustained bulk requests per minute (first downloads, offline prefetch). 0 = unpaced. */
  bulkPerMinute: number;
  /** A background request never waits longer than this for a token or the brake. */
  maxWaitMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetch: (request: Request) => Promise<Response>;
};

/** Strict shared-hosting numbers: they hold until the server announces others. */
export const DEFAULT_GOVERNOR_OPTIONS: Omit<GovernorOptions, "now" | "sleep" | "fetch"> = {
  backgroundPerMinute: 30,
  burst: 10,
  bulkPerMinute: 20,
  coalesceTtlMs: 15_000,
  maxWaitMs: 30_000,
};

/** Response header with the server's budget (`App\\Support\\TrafficBudget`). */
export const TRAFFIC_BUDGET_HEADER = "X-WGW-Traffic-Budget";

export type TrafficBudget = { background: number; bulk: number; burst: number };

/** The server clamps to the same range; the client does not trust that. */
const BUDGET_MAX = 10_000;

/**
 * `background=30; bulk=20; burst=10` → numbers, each clamped to 0–10000.
 * `null` when the header is missing or malformed (the budget then stays as it was).
 */
export function parseTrafficBudget(header: string | null): TrafficBudget | null {
  if (!header) return null;
  const values: Record<string, number> = {};
  for (const part of header.split(";")) {
    const [key, raw] = part.split("=").map((item) => item.trim());
    if (!key || raw === undefined || !/^\d{1,9}$/.test(raw)) continue;
    values[key] = Math.min(BUDGET_MAX, Number(raw));
  }
  const { background, bulk, burst } = values;
  if (background === undefined || bulk === undefined || burst === undefined) return null;
  return { background, bulk, burst };
}

const BRAKE_FIRST_MS = 2_000;
const BRAKE_MAX_MS = 60_000;
/** `Retry-After` beyond this is capped (spec: 5 minutes). */
const RETRY_AFTER_MAX_MS = 5 * 60_000;
/** Answers kept for reuse at most; a signed-in browser has a handful of keys. */
const COALESCE_MAX_ENTRIES = 32;

type Cached = { at: number; response: Promise<Response> };

export class RequestGovernor {
  private tokens: number;
  private refilledAt: number;
  private brakeUntil = 0;
  private brakeMs = 0;
  private readonly coalesced = new Map<string, Cached>();
  private queue: Promise<void> = Promise.resolve();
  private bulkQueue: Promise<void> = Promise.resolve();
  private bulkNextAt = 0;
  private laneOpenedAt = 0;
  private laneNegotiatingUntil = 0;
  private laneCallUntil = 0;
  private laneTokens: number = MEET_LANE.burst;
  private laneRefilledAt: number;
  private laneGuestGranted = true;

  constructor(private readonly options: GovernorOptions) {
    this.tokens = options.burst;
    this.refilledAt = options.now();
    this.laneRefilledAt = this.refilledAt;
  }

  /** The page's word that a Meet call is joining, negotiating, in progress or over. */
  signalMeetLane(signal: MeetLaneSignal): void {
    const now = this.options.now();
    if (signal === "left") {
      this.laneNegotiatingUntil = 0;
      this.laneCallUntil = 0;
      return;
    }
    if (signal === "call") {
      this.laneCallUntil = now + MEET_LANE.callTtlMs;
      return;
    }
    if (signal === "join" || now >= this.laneNegotiatingUntil) {
      this.laneOpenedAt = now;
      if (signal === "join") this.laneGuestGranted = false;
    }
    this.laneCallUntil = Math.max(this.laneCallUntil, now + MEET_LANE.callTtlMs);
    this.laneNegotiatingUntil = Math.min(
      now + MEET_LANE.windowMs,
      this.laneOpenedAt + MEET_LANE.maxOpenMs,
    );
  }

  /** True while the lane's room-poll window is open. */
  meetLaneOpen(): boolean {
    return this.options.now() < this.laneNegotiatingUntil;
  }

  /**
   * A background request that may skip the queue: a Meet room poll inside the
   * negotiation window (while the lane bucket has a token), or the doorbell
   * read while a call is on. Never during a brake and never for other paths.
   */
  private takeMeetLane(request: Request): boolean {
    if (request.method.toUpperCase() !== "GET") return false;
    const now = this.options.now();
    if (this.brakeUntil > now) return false;
    const path = new URL(request.url).pathname;
    if (DOORBELL_READ.test(path)) {
      if (now >= this.laneNegotiatingUntil && now >= this.laneCallUntil) return false;
      this.charge();
      return true;
    }
    if (!MEET_ROOM_POLL.test(path) || now >= this.laneNegotiatingUntil) return false;
    const guest = !request.headers.get("Authorization");
    this.refillLane(now);
    if (guest && !this.laneGuestGranted) {
      this.laneGuestGranted = true;
      this.laneTokens += MEET_LANE.guestBonus;
    }
    if (this.laneTokens < 1) return false;
    // A member's lane polls are charged to the background bucket; past half a
    // burst of debt they queue again, so the governed total stays near the budget.
    if (!guest) {
      this.refill();
      if (this.tokens <= -this.options.burst / 2) return false;
    }
    this.laneTokens -= 1;
    if (!guest) this.charge();
    return true;
  }

  private refillLane(now: number): void {
    this.laneTokens = Math.min(
      MEET_LANE.burst + MEET_LANE.guestBonus,
      this.laneTokens + (Math.max(0, now - this.laneRefilledAt) * MEET_LANE.perMinute) / 60_000,
    );
    this.laneRefilledAt = now;
  }

  /** Applies the server's budget. 0 per minute turns pacing off for that class. */
  configure(budget: TrafficBudget): void {
    this.refill();
    this.options.backgroundPerMinute = budget.background;
    this.options.bulkPerMinute = budget.bulk;
    // A bucket that holds less than one token would never release a request.
    this.options.burst = Math.max(1, budget.burst);
    this.tokens = Math.min(this.tokens, this.options.burst);
  }

  /**
   * A request the worker lets through untouched (a foreground read, a write).
   * It never waits and takes no token. A write drops every shared answer, so a
   * read after it sees the change.
   */
  observe(kind: "foreground" | "write"): void {
    if (kind === "write") this.coalesced.clear();
  }

  async handle(request: Request, kind: GovernorClass): Promise<Response> {
    if (kind === "coalesce") return this.coalesce(request);
    if (kind === "background" && this.options.backgroundPerMinute > 0) {
      if (this.takeMeetLane(request)) return this.send(request);
      await this.waitForTurn(request.signal, this.options.now());
    } else if (kind === "bulk" && this.options.bulkPerMinute > 0) {
      await this.waitForBulkTurn(request.signal);
    } else if (kind === "foreground" || kind === "write") {
      this.observe(kind);
    }
    return this.send(request);
  }

  /** Bulk requests go one after another at their own pace, never in a burst, and honour the brake. */
  private waitForBulkTurn(signal: AbortSignal): Promise<void> {
    const turn = this.bulkQueue.then(async () => {
      for (;;) {
        throwIfAborted(signal);
        // A rate of 0 means pacing is off: leave at once, without moving `bulkNextAt`.
        if (this.options.bulkPerMinute <= 0) return;
        const wait = Math.max(this.bulkNextAt, this.brakeUntil) - this.options.now();
        if (wait <= 0) break;
        await this.sleepUnlessAborted(wait, signal);
      }
      this.bulkNextAt = this.options.now() + Math.ceil(60_000 / this.options.bulkPerMinute);
    });
    this.bulkQueue = turn.catch(() => undefined);
    return turn;
  }

  /**
   * One request and one answer per session and URL for `coalesceTtlMs`. The key
   * holds a hash of the `Authorization` header, so a second user of the same
   * browser never gets the first one's answer; a request without it (cookie or
   * no session) is never shared.
   */
  private async coalesce(request: Request): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    const forced = request.cache === "reload" || request.cache === "no-store";
    if (!authorization || forced) {
      this.observe("foreground");
      return this.send(request);
    }
    const key = `${request.url}\n${await digest(authorization)}`;
    const now = this.options.now();
    this.prune(now);
    const hit = this.coalesced.get(key);
    if (hit) return (await hit.response).clone();
    // The answer outlives its first caller: a page that aborts its read must not
    // fail the others waiting on it, so the shared request carries no signal.
    // Only headers the Request constructor accepts: `Cookie` and `Referer` are
    // forbidden names there and would throw. The cookie jar still applies
    // through `credentials`.
    const headers = new Headers();
    for (const name of ["Authorization", "Accept"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const shared = new Request(request.url, {
      method: "GET",
      headers,
      credentials: request.credentials,
      mode: request.mode === "navigate" ? "same-origin" : request.mode,
      redirect: request.redirect,
    });
    this.observe("foreground");
    const response = this.send(shared).then((answer) => {
      // Only a good answer is shared; anything else is retried by the next caller.
      if (!answer.ok) this.coalesced.delete(key);
      return answer;
    });
    this.coalesced.set(key, { at: now, response });
    response.catch(() => this.coalesced.delete(key));
    return (await response).clone();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.coalesced) {
      if (now - entry.at >= this.options.coalesceTtlMs) this.coalesced.delete(key);
    }
    while (this.coalesced.size >= COALESCE_MAX_ENTRIES) {
      const oldest = this.coalesced.keys().next().value;
      if (oldest === undefined) break;
      this.coalesced.delete(oldest);
    }
  }

  /**
   * Background requests take turns, first come first served: one token each,
   * after any brake. A request that has waited `maxWaitMs` goes anyway, so
   * a long brake never freezes polls: every request goes out once its own
   * `maxWaitMs` is up, counted from `started` (when it arrived, not when it
   * reaches the front), so polls queued together go out together.
   * A request whose caller aborts leaves without spending a token.
   */
  private waitForTurn(signal: AbortSignal, started: number): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        throwIfAborted(signal);
        // A rate of 0 means pacing is off: leave at once, without spending a token.
        if (this.options.backgroundPerMinute <= 0) return;
        const now = this.options.now();
        const remaining = this.options.maxWaitMs - (now - started);
        if (remaining <= 0) break;
        const braked = this.brakeUntil - now;
        if (braked > 0) {
          await this.sleepUnlessAborted(Math.min(braked, remaining), signal);
          continue;
        }
        this.refill();
        if (this.tokens >= 1) break;
        const perMs = this.options.backgroundPerMinute / 60_000;
        await this.sleepUnlessAborted(
          Math.min(Math.ceil((1 - this.tokens) / perMs), remaining),
          signal,
        );
      }
      throwIfAborted(signal);
      this.charge();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /** Sleeps, but ends early (and throws) when the caller aborts, so a cancelled request frees the queue. */
  private async sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.options.sleep(ms), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private refill(): void {
    const now = this.options.now();
    const perMs = this.options.backgroundPerMinute / 60_000;
    this.tokens = Math.min(
      this.options.burst,
      this.tokens + Math.max(0, now - this.refilledAt) * perMs,
    );
    this.refilledAt = now;
  }

  /** Spends a token. The bucket may go into debt (down to one burst) when a request's max wait runs out. */
  private charge(): void {
    this.refill();
    this.tokens = Math.max(-this.options.burst, this.tokens - 1);
  }

  private async send(request: Request): Promise<Response> {
    try {
      const response = await this.options.fetch(request);
      // Only an answer from this origin may change the budget.
      if (response.type !== "opaque" && response.type !== "cors") {
        const budget = parseTrafficBudget(response.headers.get(TRAFFIC_BUDGET_HEADER));
        if (budget) this.configure(budget);
      }
      if (response.status === 429 || response.status === 503) {
        this.brake(this.retryAfterMs(response));
      } else {
        this.brakeMs = 0;
      }
      return response;
    } catch (error) {
      // A caller that gave up is not a sign of a struggling server.
      const aborted = request.signal.aborted || (error as Error)?.name === "AbortError";
      if (!aborted) this.brake(null);
      throw error;
    }
  }

  private brake(serverMs: number | null): void {
    this.brakeMs = this.brakeMs === 0 ? BRAKE_FIRST_MS : Math.min(BRAKE_MAX_MS, this.brakeMs * 2);
    const wait = serverMs ?? this.brakeMs;
    this.brakeUntil = Math.max(this.brakeUntil, this.options.now() + wait);
  }

  private retryAfterMs(response: Response): number | null {
    const header = response.headers.get("Retry-After")?.trim();
    if (!header) return null;
    if (/^\d+$/.test(header)) return Math.min(RETRY_AFTER_MAX_MS, Number(header) * 1000);
    const date = Date.parse(header);
    return Number.isFinite(date)
      ? Math.min(RETRY_AFTER_MAX_MS, Math.max(0, date - this.options.now()))
      : null;
  }
}

function abortError(): DOMException {
  return new DOMException("The request was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
